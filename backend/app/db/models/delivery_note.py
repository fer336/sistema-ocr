import uuid
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Index, Numeric, String, Text, Time, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DeliveryNote(Base):
    """Un remito extraído de un archivo fuente.

    Contiene SOLO los campos que el usuario pidió extraer en el MVP:
    fecha, hora, número de remito, número y nombre del cliente. Se eliminaron
    dirección, localidad, proveedor, vendedor, CUIT, condición de venta, obra,
    firmado e items.

    No hay UNIQUE(client_number, document_number): un número repetido para el
    mismo cliente debe poder insertarse igual con status='duplicate' para que
    el usuario lo revise, no rechazarse en el INSERT (ver PROPUESTA_MVP §9).
    """

    __tablename__ = "delivery_notes"
    __table_args__ = (
        Index("ix_delivery_notes_client_document", "client_number", "document_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source_files.id"), nullable=False
    )
    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id"))

    document_number: Mapped[str | None] = mapped_column(String(100))
    document_date: Mapped[date | None] = mapped_column(Date)
    document_time: Mapped[time | None] = mapped_column(Time)

    client_number: Mapped[str | None] = mapped_column(String(50))
    client_name: Mapped[str | None] = mapped_column(Text)

    drive_file_id: Mapped[str | None] = mapped_column(Text)
    drive_file_link: Mapped[str | None] = mapped_column(Text)

    page_number: Mapped[int | None] = mapped_column(default=None)

    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    status: Mapped[str] = mapped_column(String(30), default="processed")

    extraction_payload: Mapped[dict | None] = mapped_column(JSONB)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())