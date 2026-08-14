import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ShareLink(Base):
    """Link corto y permanente para compartir un remito (WhatsApp).

    `code` es lo único que se expone públicamente (`GET /s/{code}`, fuera de
    `/api/v1` a propósito, para que el link quede corto) -- nunca la key real
    de MinIO ni una URL prefirmada larga. Cada click genera una URL
    prefirmada fresca de vida corta y redirige ahí.

    El link NO vence: no hay `expires_at` a propósito. La duración la impone
    la firma fresca de cada redirect (`MINIO_PRESIGNED_EXPIRES_SECONDS`),
    no esta fila.
    """

    __tablename__ = "share_links"

    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    minio_key: Mapped[str] = mapped_column(Text, nullable=False)

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
