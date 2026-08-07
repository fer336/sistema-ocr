import uuid
from datetime import date, datetime, time
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class DeliveryNoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_number: str | None
    document_date: date | None
    document_time: time | None
    client_number: str | None
    client_name: str | None
    status: str
    confidence: Decimal | None
    drive_file_link: str | None
    created_at: datetime


class DeliveryNotePatch(BaseModel):
    document_number: str | None = None
    document_date: date | None = None
    document_time: time | None = None
    client_number: str | None = None
    client_name: str | None = None