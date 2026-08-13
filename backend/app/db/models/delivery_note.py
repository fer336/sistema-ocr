import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

#: Estados válidos de un remito.
DELIVERY_NOTE_STATUSES = ("processed", "requires_review", "duplicate", "error")


class DeliveryNote(Base):
    """Un remito extraído de un archivo fuente (PRD §15).

    Los nombres de columna son los cinco campos del PRD §4 en español, tal
    cual los define el esquema: `cliente`, `numero_cliente`, `fecha_hora`,
    `numero_remito`, `comentarios`. No hay tabla `clients`: la relación
    cliente↔remito vive acá, sin normalizar, porque el dato viene del OCR y
    puede corregirse manualmente sin arrastrar una entidad aparte.

    `fecha_hora` es TIMESTAMPTZ: el OCR devuelve `DD/MM/YYYY HH:mm` en hora
    local de Buenos Aires y se persiste convertido a UTC.

    No hay UNIQUE(numero_cliente, numero_remito): un duplicado funcional
    (PRD §14) se guarda igual con `status='duplicate'` para auditoría, nunca
    se rechaza en el INSERT ni se borra en silencio.
    """

    __tablename__ = "delivery_notes"
    __table_args__ = (
        Index("idx_delivery_notes_numero_remito", "numero_remito"),
        Index("idx_delivery_notes_numero_cliente", "numero_cliente"),
        Index("idx_delivery_notes_cliente", "cliente"),
        Index("idx_delivery_notes_fecha_hora", "fecha_hora"),
        Index("idx_delivery_notes_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source_files.id"), nullable=False
    )

    cliente: Mapped[str | None] = mapped_column(Text)
    numero_cliente: Mapped[str | None] = mapped_column(String(100))
    fecha_hora: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    numero_remito: Mapped[str | None] = mapped_column(String(150))
    comentarios: Mapped[str | None] = mapped_column(Text)

    page_number: Mapped[int | None] = mapped_column(Integer)
    detection_index: Mapped[int | None] = mapped_column(Integer)

    status: Mapped[str] = mapped_column(String(30), nullable=False, default="processed")
    extraction_payload: Mapped[dict | None] = mapped_column(JSONB)

    manually_reviewed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
