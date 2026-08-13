import uuid
from datetime import datetime

from sqlalchemy import CHAR, BigInteger, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

#: Estados válidos de un source_file (PRD §11).
SOURCE_FILE_STATUSES = (
    "uploaded",
    "pending",
    "processing",
    "processed",
    "requires_review",
    "partial",
    "error",
    "duplicate",
)


class SourceFile(Base):
    """Archivo recibido del usuario (PRD §15).

    Reemplaza el modelo Drive-céntrico del MVP anterior: ya no hay
    `drive_file_id`/`original_drive_link`; los binarios viven en MinIO y se
    referencian por key. `sha256` es la clave de dedup nivel 1 (PRD §14).
    """

    __tablename__ = "source_files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    original_filename: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    original_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    optimized_size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(CHAR(64), unique=True, nullable=False)

    minio_original_key: Mapped[str | None] = mapped_column(Text)
    minio_optimized_key: Mapped[str | None] = mapped_column(Text)
    minio_preview_key: Mapped[str | None] = mapped_column(Text)

    status: Mapped[str] = mapped_column(String(30), nullable=False, default="uploaded")
    detected_remitos: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)

    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    #: Cuándo lo reclamó un worker. Es lo único que permite distinguir un
    #: archivo que se está procesando ahora de uno que quedó colgado porque el
    #: worker murió a mitad de camino (PRD §26, "reinicio del worker").
    processing_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
