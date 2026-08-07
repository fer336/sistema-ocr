import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.db.models import DeliveryNote, SourceFile
from app.schemas.remitos import DeliveryNoteOut, DeliveryNotePatch

router = APIRouter()


async def _get_remito(db: AsyncSession, remito_id: uuid.UUID) -> DeliveryNote | None:
    result = await db.execute(select(DeliveryNote).where(DeliveryNote.id == remito_id))
    return result.scalars().first()


@router.get("", response_model=list[DeliveryNoteOut])
async def list_remitos(
    status_filter: str | None = Query(None, alias="status"),
    db: AsyncSession = Depends(get_session),
) -> list[DeliveryNote]:
    stmt = select(DeliveryNote).order_by(DeliveryNote.created_at.desc())
    if status_filter:
        stmt = stmt.where(DeliveryNote.status == status_filter)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/search", response_model=list[DeliveryNoteOut])
async def search_remitos(
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_session),
) -> list[DeliveryNote]:
    like = f"%{q}%"
    stmt = select(DeliveryNote).where(
        or_(
            DeliveryNote.client_number.ilike(like),
            DeliveryNote.client_name.ilike(like),
            DeliveryNote.document_number.ilike(like),
        )
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{remito_id}", response_model=DeliveryNoteOut)
async def get_remito(remito_id: uuid.UUID, db: AsyncSession = Depends(get_session)) -> DeliveryNote:
    remito = await _get_remito(db, remito_id)
    if not remito:
        raise HTTPException(status_code=404, detail="Remito not found")
    return remito


@router.patch("/{remito_id}", response_model=DeliveryNoteOut)
async def patch_remito(
    remito_id: uuid.UUID,
    payload: DeliveryNotePatch,
    db: AsyncSession = Depends(get_session),
) -> DeliveryNote:
    remito = await db.get(DeliveryNote, remito_id)
    if not remito:
        raise HTTPException(status_code=404, detail="Remito not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(remito, field, value)
    await db.commit()
    return await _get_remito(db, remito_id)


@router.post("/{remito_id}/approve", response_model=DeliveryNoteOut)
async def approve_remito(remito_id: uuid.UUID, db: AsyncSession = Depends(get_session)) -> DeliveryNote:
    remito = await db.get(DeliveryNote, remito_id)
    if not remito:
        raise HTTPException(status_code=404, detail="Remito not found")
    remito.status = "processed"
    await db.commit()
    return await _get_remito(db, remito_id)


@router.post("/{remito_id}/reprocess", response_model=DeliveryNoteOut)
async def reprocess_remito(remito_id: uuid.UUID, db: AsyncSession = Depends(get_session)) -> DeliveryNote:
    remito = await db.get(DeliveryNote, remito_id)
    if not remito:
        raise HTTPException(status_code=404, detail="Remito not found")

    source_file = await db.get(SourceFile, remito.source_file_id)
    if source_file:
        source_file.status = "pending"
        source_file.attempts = 0

    remito.status = "requires_review"
    await db.commit()
    return await _get_remito(db, remito_id)