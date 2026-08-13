"""Loop de polling del worker: `python -m app.worker.run`.

Reemplaza por completo los workflows de n8n (claim + proceso + cron de
reintentos), incluido el cron: `reset_retryable_errors` corre dentro del mismo
loop cada `RETRY_SWEEP_SECONDS`.
"""

import asyncio
import contextlib
import logging
import signal

from app.core.config import settings
from app.db.session import async_session_factory, engine
from app.repositories import source_files as source_files_repo
from app.services import minio_service
from app.worker.processor import process_claimed_file

logger = logging.getLogger("worker")

#: Espera entre polls cuando la cola está vacía.
IDLE_SLEEP_SECONDS = 3.0
#: Espera entre polls cuando acaba de procesar (drena la cola más rápido).
BUSY_SLEEP_SECONDS = 0.5
#: Cada cuánto se reencolan los errores reintentables.
RETRY_SWEEP_SECONDS = 60.0
#: Cuántos errores se reencolan por barrida.
RETRY_SWEEP_LIMIT = 20
#: Margen sobre OCR_TIMEOUT_SECONDS antes de dar por colgado un 'processing'.
#: Tiene que ser holgado: un worker vivo esperando al modelo no debe perder su
#: archivo a manos de otro worker.
STALE_PROCESSING_FACTOR = 4
STALE_PROCESSING_MIN_SECONDS = 600

_shutdown = asyncio.Event()


def _request_shutdown() -> None:
    logger.info("Señal de apagado recibida, terminando el ciclo actual...")
    _shutdown.set()


async def _sweep_retryable_errors() -> None:
    """Devuelve a `pending` los errores con attempts < OCR_MAX_RETRIES.

    Agotados los reintentos, la fila queda en `error` terminal: no se toca
    más hasta un reproceso explícito del usuario.
    """
    async with async_session_factory() as db:
        requeued = await source_files_repo.reset_retryable_errors(
            db, settings.ocr_max_retries, RETRY_SWEEP_LIMIT
        )
    if requeued:
        logger.info("Reencolados %s archivos en error", len(requeued))


async def _sweep_stale_processing() -> None:
    """Rescata lo que quedó en 'processing' por un worker caído.

    Sin esta barrida, matar el worker a mitad de un archivo lo deja atascado
    para siempre: `claim_pending` sólo mira 'pending'.
    """
    stale_after = max(
        settings.ocr_timeout_seconds * STALE_PROCESSING_FACTOR, STALE_PROCESSING_MIN_SECONDS
    )
    async with async_session_factory() as db:
        requeued, failed = await source_files_repo.reset_stale_processing(
            db,
            stale_after_seconds=stale_after,
            max_retries=settings.ocr_max_retries,
            limit=RETRY_SWEEP_LIMIT,
        )
    if requeued or failed:
        logger.warning(
            "Procesamientos colgados: %s reencolados, %s a error terminal", requeued, failed
        )


async def _process_batch(semaphore: asyncio.Semaphore) -> int:
    """Reclama un lote y lo procesa con concurrencia acotada."""
    async with async_session_factory() as db:
        claimed = await source_files_repo.claim_pending(db, settings.processing_batch_size)

    if not claimed:
        return 0

    logger.info("Reclamados %s archivos", len(claimed))

    async def _guarded(source_file_id) -> None:
        async with semaphore:
            await process_claimed_file(source_file_id)

    await asyncio.gather(*(_guarded(item.id) for item in claimed))
    return len(claimed)


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s [%(name)s] %(message)s",
    )

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, _request_shutdown)

    # El bucket puede no existir todavía si el worker arranca antes que el
    # backend; MinIO no lo crea solo.
    try:
        await asyncio.to_thread(minio_service.ensure_bucket)
    except minio_service.StorageError as exc:
        logger.warning("No se pudo asegurar el bucket al arrancar: %s", exc)

    semaphore = asyncio.Semaphore(settings.max_concurrent_ocr)
    next_retry_sweep = 0.0

    logger.info(
        "Worker arriba: batch=%s concurrencia=%s modelo=%s",
        settings.processing_batch_size,
        settings.max_concurrent_ocr,
        settings.ocr_model,
    )

    try:
        while not _shutdown.is_set():
            now = loop.time()
            if now >= next_retry_sweep:
                try:
                    await _sweep_stale_processing()
                    await _sweep_retryable_errors()
                except Exception:  # noqa: BLE001 - la barrida nunca mata el loop
                    logger.exception("Falló la barrida de reintentos")
                next_retry_sweep = now + RETRY_SWEEP_SECONDS

            try:
                processed = await _process_batch(semaphore)
            except Exception:  # noqa: BLE001 - ni un fallo de DB mata el loop
                logger.exception("Falló el ciclo de procesamiento")
                processed = 0

            delay = BUSY_SLEEP_SECONDS if processed else IDLE_SLEEP_SECONDS
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(_shutdown.wait(), timeout=delay)
    finally:
        await engine.dispose()
        logger.info("Worker detenido")


if __name__ == "__main__":
    asyncio.run(main())
