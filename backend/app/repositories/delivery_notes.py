from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DeliveryNote


async def find_existing(
    db: AsyncSession, client_number: str | None, document_number: str | None
) -> DeliveryNote | None:
    if not client_number or not document_number:
        return None

    stmt = select(DeliveryNote).where(
        DeliveryNote.client_number == client_number,
        DeliveryNote.document_number == document_number,
    )
    result = await db.execute(stmt)
    return result.scalars().first()
