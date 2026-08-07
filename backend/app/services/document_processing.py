import base64
import uuid
from datetime import date as date_type
from datetime import time as time_type

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DeliveryNote, SourceFile
from app.schemas.internal import DeliveryNoteCreate
from app.services import openai_extraction, pdf
from app.services.delivery_notes import persist_delivery_note
from app.services.document_number import normalize_document_number


def _page_images(file_bytes: bytes, mime_type: str) -> list[bytes]:
    if mime_type == "application/pdf":
        return pdf.pdf_to_images(file_bytes)
    return [file_bytes]


def _parse_date(value: str | None) -> date_type | None:
    if not value:
        return None
    try:
        return date_type.fromisoformat(value)
    except ValueError:
        return None


def _parse_time(value: str | None) -> time_type | None:
    if not value:
        return None
    try:
        return time_type.fromisoformat(value)
    except ValueError:
        return None


async def remitos_persistidos_response(db: AsyncSession, source_file_id: uuid.UUID) -> dict:
    """Devuelve los remitos YA guardados de un source_file con la MISMA forma
    que process_source_file ("detected_remitos" + "remitos").

    Es la respuesta del retry idempotente del endpoint /process: cuando el
    archivo ya fue procesado (o ya persistió remitos), no se vuelve a llamar a
    OpenAI ni se crean duplicados; se responde con lo que ya está en la BD,
    ordenado por página y fecha de creación como los lista el resto del
    sistema. individual_file_base64 va vacío porque acá no se dispone del
    binario de la extracción original.
    """
    result = await db.execute(
        select(DeliveryNote)
        .where(DeliveryNote.source_file_id == source_file_id)
        .order_by(DeliveryNote.page_number, DeliveryNote.created_at)
    )
    notes = list(result.scalars().all())
    remitos = [
        {
            "id": str(note.id),
            "status": note.status,
            "page": note.page_number,
            "client_number": note.client_number,
            "client_name": note.client_name,
            "document_number": note.document_number,
            "individual_file_base64": "",
        }
        for note in notes
    ]
    return {"detected_remitos": len(remitos), "remitos": remitos}


async def process_source_file(
    db: AsyncSession,
    source_file: SourceFile,
    file_bytes: bytes,
    mime_type: str,
    drive_file_link: str | None,
) -> dict:
    """Pipeline completo por archivo: rasteriza y extrae UN remito por página
    (decisión del usuario: se eliminó la detección de "1 o 2 remitos por
    página" con boxes/foco, que generaba remitos duplicados).

    Cada página del PDF es un remito: no hay crop por columnas ni shortcuts
    de vista previa recortada, la extracción de datos siempre ve la página
    completa.
    """
    pages = _page_images(file_bytes, mime_type)

    created: list[dict] = []
    total_detected = 0

    for page_number, page_image in enumerate(pages, start=1):
        extracted = await openai_extraction.extract_delivery_note(page_image)

        # Formato canónico "B 5001 00123456": el modelo a veces agrega
        # guiones u omite los prefijos, y el normalizador lo corrige.
        document_number = normalize_document_number(extracted.document_number)

        payload = DeliveryNoteCreate(
            source_file_id=source_file.id,
            document_number=document_number,
            document_date=_parse_date(extracted.document_date),
            document_time=_parse_time(extracted.document_time),
            client_number=extracted.client_number,
            client_name=extracted.client_name,
            drive_file_id=source_file.drive_file_id,
            drive_file_link=drive_file_link,
            page_number=page_number,
            confidence=extracted.confidence,
            extraction_payload=extracted.model_dump(),
        )

        note_id, note_status = await persist_delivery_note(db, payload)
        total_detected += 1

        created.append(
            {
                "id": str(note_id),
                "status": note_status,
                "page": page_number,
                "client_number": extracted.client_number,
                "client_name": extracted.client_name,
                "document_number": document_number,
                "individual_file_base64": base64.b64encode(page_image).decode("ascii"),
            }
        )

    return {"detected_remitos": total_detected, "remitos": created}