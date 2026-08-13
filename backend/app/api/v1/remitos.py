"""Listado, búsqueda, detalle, corrección y reproceso de remitos (PRD §17)."""

import logging
import uuid
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_session
from app.db.models import DeliveryNote, SourceFile, User
from app.repositories import delivery_notes as delivery_notes_repo
from app.schemas.remitos import DeliveryNoteOut, DeliveryNotePatch
from app.services import minio_service

logger = logging.getLogger(__name__)

router = APIRouter()

#: Misma zona que usa `extraction_service` para interpretar el `fecha_hora` del
#: remito. Se declara acá como texto porque Postgres la resuelve server-side.
LOCAL_TIME_ZONE = "America/Argentina/Buenos_Aires"

#: Formato con el que el frontend manda los filtros de rango. Es el mismo que
#: se le muestra al usuario y el mismo que usa `_search_clause` para el ILIKE
#: de fecha, así que no hay dos convenciones dando vueltas.
DATE_PARAM_FORMAT = "%d/%m/%Y"


async def _get_remito(db: AsyncSession, remito_id: uuid.UUID) -> DeliveryNote:
    remito = await db.get(DeliveryNote, remito_id)
    if remito is None:
        raise HTTPException(status_code=404, detail="Remito no encontrado")
    return remito


@router.get("", response_model=list[DeliveryNoteOut])
async def list_remitos(
    status_filter: str | None = Query(None, alias="status"),
    q: str | None = Query(None, min_length=1),
    cliente: str | None = Query(None, min_length=1),
    fecha_desde: str | None = Query(None, description="DD/MM/YYYY, inclusive"),
    fecha_hasta: str | None = Query(None, description="DD/MM/YYYY, inclusive"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[DeliveryNote]:
    stmt = select(DeliveryNote).order_by(DeliveryNote.created_at.desc())
    if status_filter:
        stmt = stmt.where(DeliveryNote.status == status_filter)
    if q:
        stmt = stmt.where(_search_clause(q))
    stmt = _apply_filters(stmt, cliente=cliente, fecha_desde=fecha_desde, fecha_hasta=fecha_hasta)
    stmt = stmt.limit(limit).offset(offset)
    result = await db.execute(stmt)
    return list(result.scalars().all())


def _local_fecha_hora():
    """`fecha_hora` (TIMESTAMPTZ) leído en hora de Buenos Aires.

    Misma conversión que usa `_search_clause`: el remito imprime hora local y
    el frontend la muestra local, así que cualquier filtro por fecha tiene que
    razonar sobre el día que ve el usuario, no sobre el día UTC.
    """
    return func.timezone(LOCAL_TIME_ZONE, DeliveryNote.fecha_hora)


def _parse_date_param(value: str, field: str) -> date:
    try:
        return datetime.strptime(value.strip(), DATE_PARAM_FORMAT).date()
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"{field} debe tener formato DD/MM/YYYY",
        ) from exc


def _apply_filters(
    stmt: Select,
    *,
    cliente: str | None,
    fecha_desde: str | None,
    fecha_hasta: str | None,
) -> Select:
    """Filtros dedicados, todos combinados con AND entre sí y con `q`/`status`.

    `cliente` es un filtro propio (ILIKE sobre la columna), NO otro término del
    OR de `_search_clause`: "cliente=ACME + q=00139454" tiene que devolver los
    remitos de ACME cuyo número contenga 00139454, no la unión de ambos.
    """
    if cliente:
        stmt = stmt.where(DeliveryNote.cliente.ilike(f"%{cliente}%"))
    if fecha_desde:
        desde = _parse_date_param(fecha_desde, "fecha_desde")
        stmt = stmt.where(func.date(_local_fecha_hora()) >= desde)
    if fecha_hasta:
        hasta = _parse_date_param(fecha_hasta, "fecha_hasta")
        # Ambos extremos son inclusive: el usuario elige días, no instantes.
        stmt = stmt.where(func.date(_local_fecha_hora()) <= hasta)
    return stmt


def _search_clause(q: str):
    """Búsqueda por los CINCO campos (PRD §18).

    `fecha_hora` es TIMESTAMPTZ, así que se castea a texto para poder buscar
    por fragmento ("22/06", "22/06/2026 10:35") como los otros campos.

    El casteo se hace SIEMPRE en hora de Buenos Aires, no en la zona de la
    sesión de Postgres (UTC en el contenedor). El remito imprime hora local y
    el frontend la muestra local: buscar "10:35" tiene que encontrar la fila
    que el usuario ve como 10:35, no la que en UTC es 13:35.
    """
    like = f"%{q}%"
    fecha_hora_local = _local_fecha_hora()
    return or_(
        DeliveryNote.cliente.ilike(like),
        DeliveryNote.numero_cliente.ilike(like),
        DeliveryNote.numero_remito.ilike(like),
        DeliveryNote.comentarios.ilike(like),
        func.to_char(fecha_hora_local, "DD/MM/YYYY HH24:MI").ilike(like),
    )


@router.get("/search", response_model=list[DeliveryNoteOut])
async def search_remitos(
    q: str = Query(..., min_length=1),
    cliente: str | None = Query(None, min_length=1),
    fecha_desde: str | None = Query(None, description="DD/MM/YYYY, inclusive"),
    fecha_hasta: str | None = Query(None, description="DD/MM/YYYY, inclusive"),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[DeliveryNote]:
    """Mismo filtrado que `GET /remitos`, pero con `q` obligatorio.

    Acepta los mismos filtros dedicados para que ambos endpoints no diverjan.
    """
    stmt = (
        select(DeliveryNote)
        .where(_search_clause(q))
        .order_by(DeliveryNote.created_at.desc())
    )
    stmt = _apply_filters(stmt, cliente=cliente, fecha_desde=fecha_desde, fecha_hasta=fecha_hasta)
    result = await db.execute(stmt.limit(limit))
    return list(result.scalars().all())


@router.get("/stats")
async def remito_stats(
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, int | dict[str, int]]:
    """Counts para el Dashboard (PRD §18 pantalla 1)."""
    notes = await db.execute(
        select(DeliveryNote.status, func.count()).group_by(DeliveryNote.status)
    )
    files = await db.execute(select(SourceFile.status, func.count()).group_by(SourceFile.status))
    by_status = {status: count for status, count in notes.all()}
    return {
        "total": sum(by_status.values()),
        "remitos_by_status": by_status,
        "source_files_by_status": {status: count for status, count in files.all()},
    }


@router.get("/{remito_id}", response_model=DeliveryNoteOut)
async def get_remito(
    remito_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> DeliveryNote:
    return await _get_remito(db, remito_id)


@router.delete("/{remito_id}", status_code=204)
async def delete_remito(
    remito_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> None:
    """Borra el remito. Si era el último remito de su archivo, borra también
    el archivo entero (fila + binarios en MinIO).

    Un `source_file` puede tener varios remitos (una foto con 2-3 remitos
    visibles), así que no se puede asumir 1:1 y borrar el archivo a ciegas --
    hay que fijarse si queda alguno más referenciándolo primero.
    """
    remito = await _get_remito(db, remito_id)
    source_file_id = remito.source_file_id

    await db.delete(remito)
    await db.flush()

    remaining = await delivery_notes_repo.list_by_source_file(db, source_file_id)
    if not remaining:
        source_file = await db.get(SourceFile, source_file_id)
        if source_file is not None:
            for key in (
                source_file.minio_original_key,
                source_file.minio_optimized_key,
                source_file.minio_preview_key,
            ):
                if not key:
                    continue
                try:
                    minio_service.remove_object(key)
                except minio_service.StorageError:
                    # No dejamos un remito huérfano en MinIO bloqueado el
                    # borrado del registro -- se loguea y se sigue. El objeto
                    # puede quedar colgado en el bucket, pero el usuario ya no
                    # ve nada roto en la app.
                    logger.exception("No se pudo borrar %s de MinIO al eliminar el remito", key)
            await db.delete(source_file)

    await db.commit()


@router.patch("/{remito_id}", response_model=DeliveryNoteOut)
async def patch_remito(
    remito_id: uuid.UUID,
    payload: DeliveryNotePatch,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> DeliveryNote:
    """Corrección manual (PRD §17). Deja rastro de quién y cuándo."""
    remito = await _get_remito(db, remito_id)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(remito, field, value)

    remito.manually_reviewed = True
    remito.reviewed_by = current_user.id
    remito.reviewed_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(remito)
    return remito


@router.post("/{remito_id}/approve", response_model=DeliveryNoteOut)
async def approve_remito(
    remito_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> DeliveryNote:
    remito = await _get_remito(db, remito_id)
    remito.status = "processed"
    remito.manually_reviewed = True
    remito.reviewed_by = current_user.id
    remito.reviewed_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(remito)
    return remito


@router.post("/{remito_id}/reprocess", response_model=DeliveryNoteOut)
async def reprocess_remito(
    remito_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> DeliveryNote:
    """Reencola el archivo del que salió este remito.

    El OCR trabaja por archivo, no por remito: reprocesar uno implica volver a
    procesar su `source_file`. Los remitos previos de ese archivo (incluido
    éste) los borra el worker antes de re-extraer, así que acá sólo se
    reencola.
    """
    remito = await _get_remito(db, remito_id)

    source_file = await db.get(SourceFile, remito.source_file_id)
    if source_file is None:
        raise HTTPException(status_code=404, detail="Archivo fuente no encontrado")
    if not source_file.minio_original_key and not source_file.minio_optimized_key:
        raise HTTPException(status_code=409, detail="El archivo no tiene ningún binario en MinIO")

    source_file.status = "pending"
    source_file.attempts = 0
    source_file.error_message = None
    source_file.processed_at = None

    remito.status = "requires_review"

    await db.commit()
    await db.refresh(remito)
    return remito
