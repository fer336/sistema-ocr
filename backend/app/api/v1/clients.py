import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.db.models import Client, DeliveryNote
from app.schemas.clients import ClientOut
from app.schemas.remitos import DeliveryNoteOut

router = APIRouter()


@router.get("", response_model=list[ClientOut])
async def list_clients(db: AsyncSession = Depends(get_session)) -> list[Client]:
    result = await db.execute(select(Client).order_by(Client.client_name))
    return list(result.scalars().all())


@router.get("/{client_id}", response_model=ClientOut)
async def get_client(client_id: uuid.UUID, db: AsyncSession = Depends(get_session)) -> Client:
    client = await db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.get("/{client_id}/remitos", response_model=list[DeliveryNoteOut])
async def list_client_remitos(
    client_id: uuid.UUID, db: AsyncSession = Depends(get_session)
) -> list[DeliveryNote]:
    result = await db.execute(
        select(DeliveryNote)
        .where(DeliveryNote.client_id == client_id)
        .order_by(DeliveryNote.document_date.desc())
    )
    return list(result.scalars().all())
