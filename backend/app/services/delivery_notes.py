"""Persistencia de remitos y decisión de estado (PRD §13 y §14)."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DeliveryNote
from app.repositories import delivery_notes as delivery_notes_repo
from app.schemas.processing import DeliveryNoteDraft


def determine_status(draft: DeliveryNoteDraft, is_duplicate: bool) -> str:
    """`duplicate` > `requires_review` > `processed`.

    El duplicado (PRD §14, clave funcional `numero_cliente + numero_remito`)
    gana sobre el flag de revisión porque es la información más accionable
    para el usuario: primero necesita saber que ese remito ya existe.

    El flag de revisión NO se recalcula acá: viene de `extraction_service`,
    que es el único dueño del criterio de PRD §13.
    """
    if is_duplicate:
        return "duplicate"
    if draft.requires_review:
        return "requires_review"
    return "processed"


async def persist_delivery_note(
    db: AsyncSession, draft: DeliveryNoteDraft
) -> tuple[uuid.UUID, str]:
    """Inserta el remito. Un duplicado se guarda igual, marcado.

    Nunca se rechaza el INSERT ni se borra el duplicado en silencio: queda
    registrado para revisión/auditoría (PRD §14).
    """
    existing = await delivery_notes_repo.find_existing(
        db, draft.numero_cliente, draft.numero_remito
    )
    note_status = determine_status(draft, existing is not None)

    payload = dict(draft.extraction_payload)
    if existing is not None:
        payload["duplicate_of"] = str(existing.id)

    note = DeliveryNote(
        source_file_id=draft.source_file_id,
        cliente=draft.cliente,
        numero_cliente=draft.numero_cliente,
        fecha_hora=draft.fecha_hora,
        numero_remito=draft.numero_remito,
        comentarios=draft.comentarios,
        page_number=draft.page_number,
        detection_index=draft.detection_index,
        status=note_status,
        extraction_payload=payload,
    )
    db.add(note)
    await db.flush()

    return note.id, note_status
