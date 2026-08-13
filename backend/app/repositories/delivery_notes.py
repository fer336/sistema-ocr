import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DeliveryNote


async def find_existing(
    db: AsyncSession,
    numero_cliente: str | None,
    numero_remito: str | None,
    *,
    exclude_id: uuid.UUID | None = None,
) -> DeliveryNote | None:
    """Dedup nivel 2 (PRD §14): clave funcional `numero_cliente + numero_remito`.

    Devuelve el remito PREEXISTENTE si lo hay. No borra ni rechaza nada: el
    llamador marca el nuevo como `duplicate` para que quede registrado y
    auditable.
    """
    if not numero_cliente or not numero_remito:
        return None

    stmt = select(DeliveryNote).where(
        DeliveryNote.numero_cliente == numero_cliente,
        DeliveryNote.numero_remito == numero_remito,
    )
    if exclude_id is not None:
        stmt = stmt.where(DeliveryNote.id != exclude_id)
    stmt = stmt.order_by(DeliveryNote.created_at)

    result = await db.execute(stmt)
    return result.scalars().first()


async def list_by_source_file(db: AsyncSession, source_file_id: uuid.UUID) -> list[DeliveryNote]:
    result = await db.execute(
        select(DeliveryNote)
        .where(DeliveryNote.source_file_id == source_file_id)
        .order_by(DeliveryNote.page_number, DeliveryNote.detection_index, DeliveryNote.created_at)
    )
    return list(result.scalars().all())


async def delete_by_source_file(db: AsyncSession, source_file_id: uuid.UUID) -> int:
    """Borra los remitos de un archivo antes de reprocesarlo.

    Sin esto, un reproceso explícito duplicaría cada remito del archivo.
    """
    notes = await list_by_source_file(db, source_file_id)
    for note in notes:
        await db.delete(note)
    return len(notes)
