import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ClientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_number: str
    client_name: str
    address: str | None
    locality: str | None
    drive_folder_id: str | None
    drive_folder_link: str | None
    created_at: datetime
