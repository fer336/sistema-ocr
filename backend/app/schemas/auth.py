import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class GoogleLoginRequest(BaseModel):
    """Credential del botón "Sign in with Google" del frontend."""

    id_token: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str | None
    avatar_url: str | None
    last_login_at: datetime | None
