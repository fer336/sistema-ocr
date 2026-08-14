"""Redirecciones públicas sin sesión (`/s/*`).

Fuera de `/api/v1` a propósito: quien abre un link de WhatsApp no tiene una
cuenta en el sistema. Lo único que protege el archivo acá es que `code` sea
impredecible y que cada click genere una URL prefirmada fresca de vida
corta (`MINIO_PRESIGNED_EXPIRES_SECONDS`) -- el destinatario nunca ve la
key real de MinIO ni la URL prefirmada larga.
"""

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.db.models import ShareLink
from app.services import minio_service

router = APIRouter(prefix="/s", tags=["public"])


@router.get("/{code}")
async def resolve_share_link(
    code: str,
    db: AsyncSession = Depends(get_session),
) -> RedirectResponse:
    """Redirige un link corto a una URL prefirmada de MinIO recién generada.

    El link en sí es permanente: no hay vencimiento en `share_links`. Lo que
    expira es la firma que se acuña en este click (el default de
    `MINIO_PRESIGNED_EXPIRES_SECONDS`, 15 minutos), tiempo de sobra para que
    el navegador del destinatario siga el redirect.
    """
    link = await db.get(ShareLink, code)
    if link is None:
        raise HTTPException(status_code=404, detail="Link no encontrado")

    try:
        url = await asyncio.to_thread(minio_service.presigned_get_url, link.minio_key, None)
    except minio_service.StorageError as exc:
        raise HTTPException(status_code=404, detail="El archivo ya no está disponible") from exc

    return RedirectResponse(url, status_code=307)