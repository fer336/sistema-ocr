import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UploadedFileOut(BaseModel):
    """Respuesta inicial de `POST /api/v1/uploads` (PRD §17)."""

    id: uuid.UUID
    filename: str
    status: str
    duplicate_of: uuid.UUID | None = None
    error: str | None = None


class UploadBatchOut(BaseModel):
    files: list[UploadedFileOut]


class SourceFileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    original_filename: str
    mime_type: str
    original_size_bytes: int
    optimized_size_bytes: int | None
    sha256: str
    status: str
    detected_remitos: int
    attempts: int
    error_message: str | None
    uploaded_by: uuid.UUID | None
    created_at: datetime
    processed_at: datetime | None
