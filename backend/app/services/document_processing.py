"""Orquestación del procesamiento de un archivo fuente.

Lo invoca el WORKER, no una petición HTTP (PRD §19): el OCR no debe bloquear
la respuesta de un upload múltiple.

Flujo por archivo:

    representación OCR-ready  (siempre imágenes: páginas rasterizadas o la foto)
        ↓
    ocr_service.extract       (salida cruda del modelo)
        ↓
    extraction_service.normalize
        ↓
    dedup nivel 2 + persistencia por remito
        ↓
    rollup de source_files.status
"""

import logging
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import SourceFile
from app.repositories import delivery_notes as delivery_notes_repo
from app.schemas.processing import DeliveryNoteDraft, OCRDocument, ProcessingResult
from app.services import extraction_service, image_service, ocr_service, pdf_service
from app.services.delivery_notes import persist_delivery_note

logger = logging.getLogger(__name__)

PDF_MIME_TYPE = "application/pdf"

#: Estados desde los que NO se reprocesa salvo pedido explícito.
TERMINAL_STATUSES = frozenset({"processed", "requires_review", "partial", "duplicate"})


def build_ocr_documents(file_bytes: bytes, mime_type: str) -> list[OCRDocument]:
    """Representación OCR-ready del archivo: SIEMPRE imágenes JPEG.

    - Imagen: se normaliza a JPEG (orientación/modo/resolución) y va entera.
    - PDF: se rasteriza página por página y cada página sigue el mismo camino
      que una imagen suelta. Así se conserva `page_number` en cada remito
      (PRD §21) también para los PDF de una sola página.

    Ya no existe la rama de "PDF nativo al modelo": mandar bytes PDF hacía que
    el mismo remito viajara con dos representaciones distintas según su origen
    (PDF vs foto), y dejaba la copia guardada en MinIO como PDF sin recomprimir.
    Unificar en JPEG deja un solo pipeline de calidad/peso para todo.
    """
    if mime_type == PDF_MIME_TYPE:
        return [
            OCRDocument(
                data=image_service.to_ocr_jpeg(page),
                mime_type="image/jpeg",
                page_number=index,
            )
            for index, page in enumerate(pdf_service.pdf_to_images(file_bytes), start=1)
        ]

    return [OCRDocument(data=image_service.to_ocr_jpeg(file_bytes), mime_type="image/jpeg")]


def _rollup_status(
    *,
    documents: int,
    failed_documents: int,
    note_statuses: list[str],
) -> str:
    """Estado final del archivo (PRD §11).

    - todo falló (fallo duro) → `error`, que es el único estado reintentable
    - algo falló pero algo salió → `partial`
    - cero remitos detectados, o alguno requiere revisión → `requires_review`
    - todos procesados → `processed`
    """
    if documents and failed_documents == documents:
        return "error"
    if failed_documents:
        return "partial"
    if not note_statuses:
        return "requires_review"
    if any(status == "requires_review" for status in note_statuses):
        return "requires_review"
    return "processed"


async def process_source_file(
    db: AsyncSession,
    source_file: SourceFile,
    file_bytes: bytes,
    *,
    force: bool = False,
) -> ProcessingResult:
    """Procesa un archivo completo y actualiza su estado.

    Idempotencia: si el archivo ya está en un estado terminal y no se pidió
    `force`, se responde con lo que ya está persistido sin volver a llamar al
    modelo (evita duplicar remitos ante un reintento del worker).

    `force` es el reproceso explícito del usuario: ignora el estado terminal
    y vuelve a extraer.
    """
    if source_file.status in TERMINAL_STATUSES and not force:
        existing = await delivery_notes_repo.list_by_source_file(db, source_file.id)
        return ProcessingResult(
            source_file_status=source_file.status,
            detected_remitos=len(existing),
            remitos=[
                {
                    "id": str(note.id),
                    "status": note.status,
                    "page_number": note.page_number,
                    "detection_index": note.detection_index,
                    "numero_remito": note.numero_remito,
                    "numero_cliente": note.numero_cliente,
                    "cliente": note.cliente,
                }
                for note in existing
            ],
        )

    # Siempre se limpian los remitos previos antes de extraer: en la primera
    # pasada no hay ninguno, y en un reproceso esto es lo que evita acumular
    # una copia del mismo remito por cada reintento.
    await delivery_notes_repo.delete_by_source_file(db, source_file.id)
    await db.flush()

    documents = build_ocr_documents(file_bytes, source_file.mime_type)

    created: list[dict] = []
    note_statuses: list[str] = []
    failed_documents = 0
    last_error: str | None = None

    for document in documents:
        try:
            ocr_result = await ocr_service.extract(document.data, document.mime_type)
        except ocr_service.OCRError as exc:
            # Una página que falla no debe tumbar las demás: el archivo
            # termina en `partial` si al menos otra dio remitos.
            failed_documents += 1
            last_error = str(exc)
            logger.warning(
                "OCR falló para source_file=%s página=%s: %s",
                source_file.id,
                document.page_number,
                exc,
            )
            continue

        normalized = extraction_service.normalize(ocr_result)
        if normalized.error:
            # "El modelo devuelve una estructura inválida" es criterio
            # explícito de revisión en PRD §13, no un error técnico.
            failed_documents += 1
            last_error = f"{normalized.error_type}: {normalized.message}"
            logger.warning(
                "Salida inválida del modelo para source_file=%s página=%s: %s",
                source_file.id,
                document.page_number,
                last_error,
            )
            continue

        for remito in normalized.remitos:
            draft = DeliveryNoteDraft(
                source_file_id=source_file.id,
                cliente=remito.cliente,
                numero_cliente=remito.numero_cliente,
                fecha_hora=remito.fecha_hora_utc,
                numero_remito=remito.numero_remito,
                comentarios=remito.comentarios,
                page_number=document.page_number,
                detection_index=remito.detection_index,
                requires_review=remito.requires_review,
                extraction_payload={**remito.payload, "ocr_model": ocr_result.model},
            )
            note_id, note_status = await persist_delivery_note(db, draft)
            note_statuses.append(note_status)
            created.append(
                {
                    "id": str(note_id),
                    "status": note_status,
                    "page_number": document.page_number,
                    "detection_index": remito.detection_index,
                    "numero_remito": remito.numero_remito,
                    "numero_cliente": remito.numero_cliente,
                    "cliente": remito.cliente,
                }
            )

    status = _rollup_status(
        documents=len(documents),
        failed_documents=failed_documents,
        note_statuses=note_statuses,
    )

    source_file.status = status
    source_file.detected_remitos = len(created)
    source_file.processed_at = datetime.now(UTC)
    if status == "error":
        source_file.attempts += 1
        source_file.error_message = (last_error or "OCR falló")[:500]
    else:
        source_file.error_message = last_error[:500] if last_error else None

    await db.flush()

    return ProcessingResult(
        source_file_status=status,
        detected_remitos=len(created),
        remitos=created,
        error_message=last_error,
    )
