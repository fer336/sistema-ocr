"""Entrega controlada de archivos (PRD §10, §17, §22).

El bucket es privado: nunca se expone una key ni las credenciales de MinIO,
sólo una URL prefirmada.
"""

import asyncio
import logging
import re
import uuid
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_session
from app.core.config import settings
from app.db.models import DeliveryNote, SourceFile, User
from app.schemas.remitos import FileUrlOut, ShareLinkOut, ShareLinksIn
from app.services import minio_service

logger = logging.getLogger(__name__)

router = APIRouter()

Variant = Literal["optimized", "original", "preview"]

#: Vencimiento de los links que se mandan por WhatsApp.
#:
#: 7 días es el MÁXIMO ABSOLUTO de una URL prefirmada SigV4: la propia firma
#: acota `X-Amz-Expires` a 604800 segundos y tanto S3 como MinIO rechazan la
#: request si se pide más. No existe un link prefirmado "que no caduque":
#: cualquier valor mayor no falla al firmar, falla recién cuando el
#: destinatario abre el link. Por eso está acá y no en `Settings`: no es un
#: parámetro ajustable, es un límite del protocolo. El `file-url` normal sigue
#: usando `MINIO_PRESIGNED_EXPIRES_SECONDS`, que sí es política nuestra.
SHARE_LINK_EXPIRES = timedelta(days=7)


def _pick_key(source_file: SourceFile, variant: Variant) -> str | None:
    """`optimized` cae a `original` si el optimizado no existe.

    Un archivo puede no tener versión optimizada (subida parcial, archivos
    previos a que existiera el pipeline), y en ese caso servir el original es
    mejor que devolver 404 al usuario que quiere ver su remito.

    Ojo con `original` en un PDF: desde que el optimizado es una imagen de la
    primera página, el original es la única variante con el documento completo.
    """
    if variant == "original":
        return source_file.minio_original_key
    if variant == "preview":
        return source_file.minio_preview_key or source_file.minio_optimized_key
    return source_file.minio_optimized_key or source_file.minio_original_key


def _download_filename(remito: DeliveryNote, key: str) -> str:
    """Nombre de archivo para el header `Content-Disposition` al descargar.

    Se arma del número de remito, no de la key de MinIO (que es un UUID sin
    significado para quien lo recibe). Sanitizado: `filename=` no puede llevar
    caracteres que rompan el header ni separadores de path.
    """
    extension = key.rsplit(".", 1)[-1] if "." in key else "webp"
    base = remito.numero_remito or str(remito.id)
    safe_base = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("_") or str(remito.id)
    return f"{safe_base}.{extension}"


@router.post("/share-links", response_model=list[ShareLinkOut])
async def create_share_links(
    payload: ShareLinksIn,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[ShareLinkOut]:
    """Links directos de 7 días para compartir varios remitos (WhatsApp).

    Es tolerante a fallas parciales a propósito: un ID que ya no existe o un
    remito cuyo archivo no quedó en MinIO se omite del resultado en vez de
    tumbar el pedido entero. El usuario seleccionó N filas de una tabla que
    pudo cambiar mientras elegía; que se caiga todo por una sería peor que
    compartir las que sí están.
    """
    wanted = list(dict.fromkeys(payload.remito_ids))

    result = await db.execute(select(DeliveryNote).where(DeliveryNote.id.in_(wanted)))
    remitos = {remito.id: remito for remito in result.scalars().all()}

    source_file_ids = {remito.source_file_id for remito in remitos.values()}
    source_files: dict[uuid.UUID, SourceFile] = {}
    if source_file_ids:
        files_result = await db.execute(
            select(SourceFile).where(SourceFile.id.in_(source_file_ids))
        )
        source_files = {source_file.id: source_file for source_file in files_result.scalars().all()}

    pending: list[tuple[DeliveryNote, str]] = []
    for remito_id in wanted:
        remito = remitos.get(remito_id)
        if remito is None:
            logger.info("share-links: remito %s no existe, se omite", remito_id)
            continue
        source_file = source_files.get(remito.source_file_id)
        key = _pick_key(source_file, "optimized") if source_file is not None else None
        if not key:
            logger.info("share-links: remito %s no tiene binario en MinIO, se omite", remito_id)
            continue
        pending.append((remito, key))

    def _sign_all() -> list[str]:
        return [
            minio_service.presigned_get_url(key, int(SHARE_LINK_EXPIRES.total_seconds()))
            for _, key in pending
        ]

    try:
        urls = await asyncio.to_thread(_sign_all)
    except minio_service.StorageError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return [
        ShareLinkOut(
            id=remito.id,
            cliente=remito.cliente,
            numero_remito=remito.numero_remito,
            fecha_hora=remito.fecha_hora,
            url=url,
        )
        for (remito, _), url in zip(pending, urls, strict=True)
    ]


@router.get("/{remito_id}/file-url", response_model=FileUrlOut)
async def get_remito_file_url(
    remito_id: uuid.UUID,
    variant: Variant = Query("optimized"),
    download: bool = Query(
        False, description="Fuerza Content-Disposition: attachment con el número de remito."
    ),
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> FileUrlOut:
    remito = await db.get(DeliveryNote, remito_id)
    if remito is None:
        raise HTTPException(status_code=404, detail="Remito no encontrado")

    source_file = await db.get(SourceFile, remito.source_file_id)
    if source_file is None:
        raise HTTPException(status_code=404, detail="Archivo fuente no encontrado")

    key = _pick_key(source_file, variant)
    if not key:
        raise HTTPException(status_code=404, detail="El archivo no está almacenado en MinIO")

    filename = _download_filename(remito, key) if download else None

    try:
        url = await asyncio.to_thread(minio_service.presigned_get_url, key, None, filename)
    except minio_service.StorageError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return FileUrlOut(url=url, expires_in_seconds=settings.minio_presigned_expires_seconds)
