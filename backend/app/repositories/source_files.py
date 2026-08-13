import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import SourceFile


async def get_by_sha256(db: AsyncSession, sha256: str) -> SourceFile | None:
    """Dedup nivel 1 (PRD §14): archivo byte-idéntico ya subido."""
    result = await db.execute(select(SourceFile).where(SourceFile.sha256 == sha256))
    return result.scalars().first()


async def get(db: AsyncSession, source_file_id: uuid.UUID) -> SourceFile | None:
    return await db.get(SourceFile, source_file_id)


async def claim_pending(db: AsyncSession, limit: int) -> list[SourceFile]:
    """Reclama hasta `limit` archivos pendientes de forma atómica.

    Un único UPDATE...RETURNING sobre un SELECT FOR UPDATE SKIP LOCKED evita
    que dos workers concurrentes tomen el mismo archivo (un select-luego-update
    en dos pasos separados sí permitiría el doble claim).
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
        # `processing_started_at` es el reloj que después usa
        # `reset_stale_processing` para recuperar lo que quedó colgado.
        .values(status="processing", processing_started_at=func.now())
        .returning(SourceFile)
    )
    result = await db.execute(stmt)
    rows = list(result.scalars().all())
    await db.commit()
    return rows


async def reset_stale_processing(
    db: AsyncSession, *, stale_after_seconds: int, max_retries: int, limit: int
) -> tuple[int, int]:
    """Recupera archivos que quedaron colgados en 'processing'.

    Si el worker muere después de `claim_pending` y antes de terminar, la fila
    queda en 'processing' para siempre: `claim_pending` sólo mira 'pending' y
    `reset_retryable_errors` sólo mira 'error'. Nadie la volvería a tocar.

    Un archivo se considera colgado cuando lleva más de `stale_after_seconds`
    reclamado (holgado respecto de OCR_TIMEOUT_SECONDS, para no robarle el
    trabajo a un worker vivo que sigue esperando al modelo).

    Devuelve `(reencolados, marcados_error)`. Los que ya agotaron los intentos
    NO se reencolan: quedan en `error` terminal, para que un archivo que hace
    caer al worker no lo tumbe en loop.
    """
    cutoff = datetime.now(UTC) - timedelta(seconds=stale_after_seconds)
    stale = (
        SourceFile.status == "processing",
        or_(
            SourceFile.processing_started_at.is_(None),
            SourceFile.processing_started_at < cutoff,
        ),
    )

    requeue_subquery = (
        select(SourceFile.id)
        .where(*stale, SourceFile.attempts + 1 < max_retries)
        .order_by(SourceFile.created_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    requeued = await db.execute(
        update(SourceFile)
        .where(SourceFile.id.in_(requeue_subquery))
        .values(
            status="pending",
            attempts=SourceFile.attempts + 1,
            processing_started_at=None,
            error_message="Procesamiento interrumpido: el archivo se reencoló",
        )
        .returning(SourceFile.id)
    )
    requeued_count = len(requeued.scalars().all())

    exhausted_subquery = (
        select(SourceFile.id)
        .where(*stale, SourceFile.attempts + 1 >= max_retries)
        .order_by(SourceFile.created_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    failed = await db.execute(
        update(SourceFile)
        .where(SourceFile.id.in_(exhausted_subquery))
        .values(
            status="error",
            attempts=SourceFile.attempts + 1,
            processing_started_at=None,
            error_message="Procesamiento interrumpido y sin reintentos disponibles",
        )
        .returning(SourceFile.id)
    )
    failed_count = len(failed.scalars().all())

    await db.commit()
    return requeued_count, failed_count


async def reset_retryable_errors(db: AsyncSession, max_retries: int, limit: int) -> list[SourceFile]:
    """Vuelve a 'pending' los archivos en error con attempts < max_retries.

    Mismo patrón atómico que claim_pending. El worker lo llama periódicamente
    dentro de su propio loop (reemplaza el cron de reintentos externo); el
    archivo reencolado lo recoge el claim normal del siguiente ciclo, sin
    lógica de retry duplicada en el llamador.
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
