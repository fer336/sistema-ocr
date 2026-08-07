import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session, require_internal_token
from app.core.config import settings
from app.db.models import Client, DeliveryNote, SourceFile
from app.repositories import source_files as source_files_repo
from app.schemas.clients import ClientOut
from app.schemas.internal import (
    ClaimRequest,
    ClientFolderPatch,
    DeliveryNoteCreate,
    DeliveryNoteFilePatch,
    SourceFileCreate,
    SourceFileOut,
    SourceFileStatusPatch,
)
from app.services import document_processing
from app.services.delivery_notes import persist_delivery_note

router = APIRouter(dependencies=[Depends(require_internal_token)])


@router.post("/source-files", response_model=SourceFileOut, status_code=201)
async def create_source_file(
    payload: SourceFileCreate, db: AsyncSession = Depends(get_session)
) -> SourceFile:
    result = await db.execute(select(SourceFile).where(SourceFile.drive_file_id == payload.drive_file_id))
    existing = result.scalars().first()
    if existing:
        return existing

    source_file = SourceFile(
        drive_file_id=payload.drive_file_id,
        original_filename=payload.original_filename,
        original_drive_link=payload.original_drive_link,
    )
    db.add(source_file)
    await db.commit()
    await db.refresh(source_file)
    return source_file


@router.post("/source-files/claim", response_model=list[SourceFileOut])
async def claim_source_files(
    payload: ClaimRequest, db: AsyncSession = Depends(get_session)
) -> list[SourceFile]:
    return await source_files_repo.claim_pending(db, payload.limit)


@router.post("/source-files/reset-errors", response_model=list[SourceFileOut])
async def reset_retryable_errors(
    payload: ClaimRequest, db: AsyncSession = Depends(get_session)
) -> list[SourceFile]:
    """Vuelve a pending los archivos en error con attempts < MAX_RETRIES.

    El workflow 3 de n8n (reintentos) solo llama a esto en su cron; el
    archivo reencolado lo recoge Workflow 2 en su próximo ciclo normal.
    """
    return await source_files_repo.reset_retryable_errors(db, settings.max_retries, payload.limit)


@router.patch("/source-files/{source_file_id}/status", response_model=SourceFileOut)
async def update_source_file_status(
    source_file_id: uuid.UUID,
    payload: SourceFileStatusPatch,
    db: AsyncSession = Depends(get_session),
) -> SourceFile:
    source_file = await db.get(SourceFile, source_file_id)
    if not source_file:
        raise HTTPException(status_code=404, detail="Source file not found")

    source_file.status = payload.status
    if payload.error_message is not None:
        source_file.error_message = payload.error_message
    if payload.detected_remitos is not None:
        source_file.detected_remitos = payload.detected_remitos
    if payload.status == "error":
        source_file.attempts += 1

    await db.commit()
    await db.refresh(source_file)
    return source_file


@router.post("/source-files/{source_file_id}/process")
async def process_source_file(
    source_file_id: uuid.UUID,
    request: Request,
    drive_file_link: str | None = Query(None),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Pipeline completo: n8n descarga el archivo de Drive y manda el binario
    tal cual en el body (Content-Type = el mime del archivo, sin multipart:
    más simple de cablear en el HTTP Request node de n8n que combinar
    binaryData + form fields). FastAPI rasteriza si es PDF, llama a OpenAI
    para detectar/extraer cada remito y los persiste. n8n solo necesita el
    `status` de la respuesta para decidir a qué carpeta de Drive mover el
    archivo.
    """
    source_file = await db.get(SourceFile, source_file_id)
    if not source_file:
        raise HTTPException(status_code=404, detail="Source file not found")

    # Idempotencia: si el archivo ya se procesó (estado final) o ya tiene
    # remitos persistidos, NO reprocesar ni llamar a OpenAI. Caso real: n8n
    # reenvía el POST cuando el curl expira (~60s), y sin este chequeo se
    # creaban duplicados para el mismo source_file. Devolvemos 200 con lo que
    # ya está en la BD y el status actual del archivo, que es lo que n8n usa
    # para decidir la carpeta de Drive (nunca romper con 409/500 acá).
    persisted = await document_processing.remitos_persistidos_response(db, source_file.id)
    if source_file.status in {"processed", "requires_review"} or persisted["remitos"]:
        return {**persisted, "source_file_status": source_file.status}

    file_bytes = await request.body()
    mime_type = request.headers.get("content-type", "application/octet-stream").split(";")[0]

    try:
        result = await document_processing.process_source_file(
            db, source_file, file_bytes, mime_type, drive_file_link
        )
    except Exception as exc:  # noqa: BLE001 — cualquier falla de OpenAI/parseo debe marcar error, no tumbar el pipeline
        source_file.status = "error"
        source_file.attempts += 1
        source_file.error_message = str(exc)[:500]
        await db.commit()
        raise HTTPException(status_code=502, detail=f"Processing failed: {exc}") from exc

    any_requires_review = any(r["status"] == "requires_review" for r in result["remitos"])
    source_file.status = "requires_review" if any_requires_review else "processed"
    source_file.detected_remitos = result["detected_remitos"]
    await db.commit()

    return {**result, "source_file_status": source_file.status}


@router.get("/clients/by-number/{client_number}", response_model=ClientOut)
async def get_client_by_number(client_number: str, db: AsyncSession = Depends(get_session)) -> Client:
    result = await db.execute(select(Client).where(Client.client_number == client_number))
    client = result.scalars().first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.patch("/clients/{client_id}/drive-folder")
async def set_client_drive_folder(
    client_id: uuid.UUID, payload: ClientFolderPatch, db: AsyncSession = Depends(get_session)
) -> dict[str, str]:
    """n8n llama esto una sola vez, cuando crea (o encuentra) la carpeta del
    cliente en Drive. Los próximos remitos del mismo cliente reusan el ID
    guardado acá en vez de que n8n tenga que buscarlo de nuevo cada vez.
    """
    client = await db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    client.drive_folder_id = payload.drive_folder_id
    client.drive_folder_link = payload.drive_folder_link
    await db.commit()
    return {"id": str(client.id), "drive_folder_id": client.drive_folder_id}


@router.patch("/remitos/{remito_id}/file")
async def set_remito_file(
    remito_id: uuid.UUID, payload: DeliveryNoteFilePatch, db: AsyncSession = Depends(get_session)
) -> dict[str, str]:
    """n8n llama esto después de subir el archivo individual del remito a la
    carpeta del cliente, para que drive_file_link deje de apuntar al archivo
    original y pase a apuntar al archivo propio de ese remito.
    """
    remito = await db.get(DeliveryNote, remito_id)
    if not remito:
        raise HTTPException(status_code=404, detail="Remito not found")

    remito.drive_file_id = payload.drive_file_id
    remito.drive_file_link = payload.drive_file_link
    await db.commit()
    return {"id": str(remito.id), "drive_file_link": remito.drive_file_link or ""}


@router.post("/remitos", status_code=201)
async def create_remito(
    payload: DeliveryNoteCreate, db: AsyncSession = Depends(get_session)
) -> dict[str, str]:
    """Registra un remito ya extraído (uso directo, sin pasar por /process).

    Un número de remito repetido para el mismo cliente NO rechaza el insert:
    se guarda igual con status='duplicate' para que el usuario lo revise
    desde el frontend (ver PROPUESTA_MVP §9 y hallazgo #2 del plan).
    """
    note_id, note_status = await persist_delivery_note(db, payload)
    await db.commit()
    return {"id": str(note_id), "status": note_status}
