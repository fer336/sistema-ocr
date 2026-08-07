import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Client, DeliveryNote
from app.repositories import delivery_notes as delivery_notes_repo
from app.schemas.internal import DeliveryNoteCreate

CONFIDENCE_THRESHOLD = Decimal("0.85")


def _has_critical_fields(payload: DeliveryNoteCreate) -> bool:
    return bool(
        payload.client_number
        and payload.client_name
        and payload.document_number
        and payload.document_date
    )


def determine_status(payload: DeliveryNoteCreate, is_duplicate: bool) -> str:
    """Reglas de estado según PROPUESTA_MVP §9 y §12.

    Un duplicado se guarda igual (no se rechaza el insert) para que el
    usuario lo revise; la confianza/campos críticos solo deciden entre
    processed y requires_review cuando no es duplicado.
    """
    if is_duplicate:
        return "duplicate"
    if (
        payload.confidence is not None
        and payload.confidence >= CONFIDENCE_THRESHOLD
        and _has_critical_fields(payload)
    ):
        return "processed"
    return "requires_review"


async def persist_delivery_note(db: AsyncSession, payload: DeliveryNoteCreate) -> tuple[uuid.UUID, str]:
    existing = await delivery_notes_repo.find_existing(db, payload.client_number, payload.document_number)
    note_status = determine_status(payload, existing is not None)

    client_id = None
    if payload.client_number:
        result = await db.execute(select(Client).where(Client.client_number == payload.client_number))
        client = result.scalars().first()
        if client:
            client_id = client.id
        elif payload.client_name:
            client = Client(client_number=payload.client_number, client_name=payload.client_name)
            db.add(client)
            await db.flush()
            client_id = client.id

    remito = DeliveryNote(
        source_file_id=payload.source_file_id,
        client_id=client_id,
        document_number=payload.document_number,
        document_date=payload.document_date,
        document_time=payload.document_time,
        client_number=payload.client_number,
        client_name=payload.client_name,
        drive_file_id=payload.drive_file_id,
        drive_file_link=payload.drive_file_link,
        page_number=payload.page_number,
        confidence=payload.confidence,
        extraction_payload=payload.extraction_payload,
        status=note_status,
    )
    db.add(remito)
    await db.flush()

    return remito.id, note_status