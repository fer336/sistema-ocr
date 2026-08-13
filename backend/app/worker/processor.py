"""Procesamiento de UN archivo reclamado por el worker."""

import asyncio
import logging
import uuid

from app.db.models import SourceFile
from app.db.session import async_session_factory
from app.services import document_processing, minio_service

logger = logging.getLogger(__name__)

#: Estados en los que el OCR definitivamente corrió y no va a reintentarse
#: solo (a diferencia de "error", que `reset_retryable_errors` puede
#: reencolar). Recién ahí es seguro borrar el original de MinIO.
_TERMINAL_STATUSES_WITH_OCR = {"processed", "requires_review", "partial"}


async def process_claimed_file(source_file_id: uuid.UUID, *, force: bool = False) -> str:
    """Trae el binario de MinIO, procesa y commitea.

    Sesión propia por archivo: dos archivos procesándose en paralelo no deben
    compartir transacción, para que el fallo de uno no revierta al otro.

    Cualquier excepción no controlada deja la fila en `error` con
    `attempts += 1`; el reencolado lo decide `reset_retryable_errors` según
    `OCR_MAX_RETRIES`.
    """
    async with async_session_factory() as db:
        source_file = await db.get(SourceFile, source_file_id)
        if source_file is None:
            logger.warning("source_file %s desapareció antes de procesarse", source_file_id)
            return "missing"

        # El original es transitorio (se borra abajo tras procesar con éxito):
        # si ya no está, el WebP optimizado es el único binario que queda.
        # Reprocesar sobre esa copia es peor para el OCR pero mejor que 409.
        key = source_file.minio_original_key or source_file.minio_optimized_key
        if not key:
            source_file.status = "error"
            source_file.attempts += 1
            source_file.error_message = "El archivo no tiene ningún binario en MinIO"
            await db.commit()
            return "error"

        try:
            file_bytes = await asyncio.to_thread(minio_service.get_object_bytes, key)
            result = await document_processing.process_source_file(
                db, source_file, file_bytes, force=force
            )
            await db.commit()
            logger.info(
                "source_file %s -> %s (%s remitos)",
                source_file_id,
                result.source_file_status,
                result.detected_remitos,
            )

            if result.source_file_status in _TERMINAL_STATUSES_WITH_OCR:
                await _cleanup_original(db, source_file)

            return result.source_file_status
        except Exception as exc:  # noqa: BLE001 - ningún fallo debe matar el loop
            logger.exception("Fallo procesando source_file %s", source_file_id)
            await db.rollback()
            failed = await db.get(SourceFile, source_file_id)
            if failed is not None:
                failed.status = "error"
                failed.attempts += 1
                failed.error_message = str(exc)[:500]
                await db.commit()
            return "error"


async def _cleanup_original(db, source_file: SourceFile) -> None:
    """Borra el original de MinIO una vez que el OCR ya no lo necesita.

    Solo queda persistido el WebP optimizado (decisión del proyecto: nunca
    guardar el original de forma permanente). El borrado va DESPUÉS del
    commit principal y en su propia transacción: si algo falla acá, el
    resultado del OCR ya quedó guardado igual, y el original simplemente
    queda un rato más de lo previsto en vez de perderse la referencia antes
    de confirmar que se borró de verdad.
    """
    original_key = source_file.minio_original_key
    if not original_key:
        return
    try:
        await asyncio.to_thread(minio_service.remove_object, original_key)
    except minio_service.StorageError:
        logger.exception("No se pudo borrar el original %s de MinIO", original_key)
        return
    source_file.minio_original_key = None
    await db.commit()
