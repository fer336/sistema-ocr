from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import SourceFile


async def claim_pending(db: AsyncSession, limit: int) -> list[SourceFile]:
    """Reclama hasta `limit` archivos pendientes de forma atómica.

    Un único UPDATE...RETURNING sobre un SELECT FOR UPDATE SKIP LOCKED evita
    que dos ejecuciones concurrentes de n8n tomen el mismo archivo (ver
    hallazgo #3 del plan: el doc original hacía select-luego-update en dos
    pasos separados).
    """
    subquery = (
        select(SourceFile.id)
        .where(SourceFile.status == "pending")
        .order_by(SourceFile.created_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    stmt = (
        update(SourceFile)
        .where(SourceFile.id.in_(subquery))
        .values(status="processing")
        .returning(SourceFile)
    )
    result = await db.execute(stmt)
    rows = list(result.scalars().all())
    await db.commit()
    return rows


async def reset_retryable_errors(db: AsyncSession, max_retries: int, limit: int) -> list[SourceFile]:
    """Vuelve a 'pending' los archivos en error con attempts < max_retries.

    Mismo patrón atómico que claim_pending: el workflow 3 de n8n (reintentos)
    solo llama a este endpoint en su cron; el archivo reencolado lo recoge
    el workflow 2 en su próximo ciclo normal de claim, sin lógica de retry
    duplicada en n8n.
    """
    subquery = (
        select(SourceFile.id)
        .where(SourceFile.status == "error", SourceFile.attempts < max_retries)
        .order_by(SourceFile.created_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    stmt = (
        update(SourceFile)
        .where(SourceFile.id.in_(subquery))
        .values(status="pending")
        .returning(SourceFile)
    )
    result = await db.execute(stmt)
    rows = list(result.scalars().all())
    await db.commit()
    return rows
