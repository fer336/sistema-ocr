"""Carga de archivos (PRD §7, §9, §10, §14, §17)."""

import asyncio
import hashlib
import logging
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_session
from app.core.config import settings
from app.db.models import SourceFile, User
from app.repositories import delivery_notes as delivery_notes_repo
from app.repositories import source_files as source_files_repo
from app.schemas.uploads import SourceFileOut, UploadBatchOut, UploadedFileOut
from app.services import image_service, minio_service, pdf_service

logger = logging.getLogger(__name__)

router = APIRouter()

PDF_MIME_TYPE = "application/pdf"
ACCEPTED_MIME_TYPES = image_service.SUPPORTED_IMAGE_MIME_TYPES | {PDF_MIME_TYPE}


def _normalize_mime(upload: UploadFile) -> str:
    mime = (upload.content_type or "").split(";")[0].strip().lower()
    return "image/jpeg" if mime == "image/jpg" else mime


async def _store_binaries(
    source_file_id: uuid.UUID, filename: str, mime_type: str, data: bytes
) -> tuple[str, str | None, str | None, int | None]:
    """Sube original + optimizado + preview a MinIO (PRD §10).

    El original es TRANSITORIO: el worker lo necesita para hacer OCR con
    buena calidad, y lo borra apenas termina de procesar (ver
    `worker/processor.py::_cleanup_original`). Lo único que persiste para
    siempre es el WebP optimizado (~300 KB) y el preview -- decisión del
    proyecto para no acumular espacio en MinIO con originales sin usar.

    Imagen y PDF comparten el mismo pipeline: el PDF se rasteriza y de ahí en
    más se trata como una foto, así la copia optimizada pesa ~300 KB en los dos
    casos (PRD §9) en vez de quedar como un PDF sin recomprimir.

    El SDK de MinIO y Pillow son bloqueantes, así que todo esto va a un hilo
    para no clavar el event loop durante una carga múltiple.
    """

    def _work() -> tuple[str, str | None, str | None, int | None]:
        original = minio_service.original_key(source_file_id, filename)
        minio_service.put_object(original, data, mime_type)

        # De un PDF multipágina se deriva la PRIMERA página: `optimized` y
        # `preview` son una key cada uno. El OCR sí procesa todas las páginas,
        # pero ATENCIÓN: como el original se borra tras procesar (ver
        # `worker/processor.py::_cleanup_original`), la representación visual
        # de las páginas 2+ no queda guardada en ningún lado una vez que
        # termina el OCR -- solo persisten los datos extraídos de esas
        # páginas, no una imagen para volver a mirarlas.
        source_image = (
            pdf_service.pdf_first_page_image(data, dpi=pdf_service.DEFAULT_DPI)
            if mime_type == PDF_MIME_TYPE
            else data
        )

        optimized = image_service.optimize_image(source_image)
        optimized_key = minio_service.optimized_key(source_file_id, optimized.extension)
        minio_service.put_object(optimized_key, optimized.data, optimized.content_type)

        preview = image_service.make_preview(source_image)
        preview_key = minio_service.preview_key(source_file_id, preview.extension)
        minio_service.put_object(preview_key, preview.data, preview.content_type)

        return original, optimized_key, preview_key, len(optimized.data)

    return await asyncio.to_thread(_work)


@router.post("", response_model=UploadBatchOut, status_code=status.HTTP_201_CREATED)
async def create_uploads(
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> UploadBatchOut:
    """Carga múltiple. Devuelve un resultado por archivo (PRD §17).

    El OCR NO corre acá: el archivo queda en `pending` y lo toma el worker
    (PRD §19). Un archivo malo no invalida el lote entero: cada uno lleva su
    propio `status`.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No se recibió ningún archivo")

    results: list[UploadedFileOut] = []

    for upload in files:
        filename = upload.filename or "archivo"
        mime_type = _normalize_mime(upload)

        if mime_type not in ACCEPTED_MIME_TYPES:
            results.append(
                UploadedFileOut(
                    id=uuid.uuid4(),
                    filename=filename,
                    status="error",
                    error=f"Tipo de archivo no permitido: {mime_type or 'desconocido'}",
                )
            )
            continue

        data = await upload.read()
        await upload.close()

        if not data:
            results.append(
                UploadedFileOut(
                    id=uuid.uuid4(), filename=filename, status="error", error="Archivo vacío"
                )
            )
            continue

        if len(data) > settings.max_upload_bytes:
            results.append(
                UploadedFileOut(
                    id=uuid.uuid4(),
                    filename=filename,
                    status="error",
                    error=f"El archivo supera el límite de {settings.max_upload_mb} MB",
                )
            )
            continue

        # --- Dedup nivel 1 (PRD §14): mismo archivo byte a byte -----------
        sha256 = hashlib.sha256(data).hexdigest()
        existing = await source_files_repo.get_by_sha256(db, sha256)
        if existing is not None:
            # Ni se sube a MinIO ni se encola OCR: ya está procesado o en cola.
            results.append(
                UploadedFileOut(
                    id=existing.id,
                    filename=filename,
                    status="duplicate",
                    duplicate_of=existing.id,
                )
            )
            continue

        source_file_id = uuid.uuid4()
        try:
            original_key, optimized_key, preview_key, optimized_size = await _store_binaries(
                source_file_id, filename, mime_type, data
            )
        except Exception as exc:  # noqa: BLE001 - ver comentario
            # Frontera por archivo: un archivo malo NO puede tumbar el lote.
            # Además de ImageProcessingError/StorageError/ValueError, un PDF
            # corrupto levanta `fitz.FileDataError` (un RuntimeError), que si
            # se filtrara devolvería 500 para toda la carga múltiple.
            logger.exception("Falló el almacenamiento de %s", filename)
            results.append(
                UploadedFileOut(
                    id=source_file_id, filename=filename, status="error", error=str(exc)
                )
            )
            continue

        source_file = SourceFile(
            id=source_file_id,
            original_filename=filename,
            mime_type=mime_type,
            original_size_bytes=len(data),
            optimized_size_bytes=optimized_size,
            sha256=sha256,
            minio_original_key=original_key,
            minio_optimized_key=optimized_key,
            minio_preview_key=preview_key,
            status="pending",
            uploaded_by=current_user.id,
        )
        db.add(source_file)
        await db.flush()

        results.append(
            UploadedFileOut(id=source_file.id, filename=filename, status="pending")
        )

    await db.commit()
    return UploadBatchOut(files=results)


@router.get("", response_model=list[SourceFileOut])
async def list_uploads(
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[SourceFile]:
    """Lista archivos subidos (PRD §11), no remitos.

    Existe sobre todo para poder VER los que quedaron en `error`: esos nunca
    llegan a tener un `DeliveryNote` asociado (el OCR nunca extrajo nada), así
    que `GET /remitos` jamás los va a mostrar por más filtro que se use -- el
    Dashboard cuenta ese estado pero, sin este endpoint, no había forma de
    verlos ni de reprocesarlos.
    """
    stmt = select(SourceFile).order_by(SourceFile.created_at.desc())
    if status_filter:
        stmt = stmt.where(SourceFile.status == status_filter)
    stmt = stmt.limit(limit).offset(offset)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{source_file_id}", response_model=SourceFileOut)
async def get_upload(
    source_file_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> SourceFile:
    source_file = await db.get(SourceFile, source_file_id)
    if source_file is None:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return source_file


@router.post("/{source_file_id}/reprocess", response_model=SourceFileOut)
async def reprocess_upload(
    source_file_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> SourceFile:
    """Reproceso explícito: la única forma de volver a pasar OCR sobre un
    archivo ya procesado o marcado como duplicado (PRD §14).

    Borra los remitos previos del archivo para no acumular copias y lo vuelve
    a poner en la cola con `attempts=0`.
    """
    source_file = await db.get(SourceFile, source_file_id)
    if source_file is None:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    if not source_file.minio_original_key and not source_file.minio_optimized_key:
        raise HTTPException(status_code=409, detail="El archivo no tiene ningún binario en MinIO")

    await delivery_notes_repo.delete_by_source_file(db, source_file.id)

    source_file.status = "pending"
    source_file.attempts = 0
    source_file.error_message = None
    source_file.detected_remitos = 0
    source_file.processed_at = None

    await db.commit()
    await db.refresh(source_file)
    return source_file


@router.delete("/{source_file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_upload(
    source_file_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> None:
    """Borra un archivo fallido desde la pantalla de Errores (PRD §11).

    Estos archivos nunca llegaron a tener un `DeliveryNote` (el OCR no
    extrajo nada), así que no hay nada que desvincular -- a diferencia de
    `DELETE /remitos/{id}`, acá se borra el `SourceFile` directo.
    """
    source_file = await db.get(SourceFile, source_file_id)
    if source_file is None:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    for key in (
        source_file.minio_original_key,
        source_file.minio_optimized_key,
        source_file.minio_preview_key,
    ):
        if not key:
            continue
        try:
            await asyncio.to_thread(minio_service.remove_object, key)
        except minio_service.StorageError as exc:
            logger.warning("No se pudo borrar %s de MinIO: %s", key, exc)

    await db.delete(source_file)
    await db.commit()
