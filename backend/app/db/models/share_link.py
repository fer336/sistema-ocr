import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ShareLink(Base):
    """Link corto para compartir un remito (WhatsApp).

    `code` es lo único que se expone públicamente (`GET /s/{code}`, fuera de
    `/api/v1` a propósito, para que el link quede corto) -- nunca la key real
    de MinIO ni una URL prefirmada larga. Cada click genera una URL
    prefirmada fresca de vida corta y redirige ahí; el propio `ShareLink` es
    el que vence a los 7 días (el máximo real de una firma SigV4), no la URL
    firmada de cada redirect.
    """

    __tablename__ = "share_links"

    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    minio_key: Mapped[str] = mapped_column(Text, nullable=False)

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
