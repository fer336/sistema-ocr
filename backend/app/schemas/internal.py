import uuid
from datetime import date, time
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class SourceFileCreate(BaseModel):
    drive_file_id: str
    original_filename: str
    original_drive_link: str | None = None


class SourceFileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    drive_file_id: str
    original_filename: str
    original_drive_link: str | None
    status: str
    attempts: int


class SourceFileStatusPatch(BaseModel):
    status: str
    error_message: str | None = None
    detected_remitos: int | None = None


class ClaimRequest(BaseModel):
    limit: int = 3


class DeliveryNoteCreate(BaseModel):
    source_file_id: uuid.UUID
    document_number: str | None = None
    document_date: date | None = None
    document_time: time | None = None
    client_number: str | None = None
    client_name: str | None = None
    drive_file_id: str | None = None
    drive_file_link: str | None = None
    page_number: int | None = None
    confidence: Decimal | None = None
    extraction_payload: dict | None = None


class ClientFolderPatch(BaseModel):
    drive_folder_id: str
    drive_folder_link: str | None = None


class DeliveryNoteFilePatch(BaseModel):
    drive_file_id: str
    drive_file_link: str | None = None