import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DeliveryNoteOut(BaseModel):
    """Los cinco campos de PRD §4 más el estado y la trazabilidad."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_file_id: uuid.UUID

    cliente: str | None
    numero_cliente: str | None
    fecha_hora: datetime | None
    numero_remito: str | None
    comentarios: str | None

    page_number: int | None
    detection_index: int | None
    status: str
    manually_reviewed: bool
    reviewed_by: uuid.UUID | None
    reviewed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class DeliveryNotePatch(BaseModel):
    """Corrección manual. Sólo los cinco campos son editables.

    `numero_remito` se guarda tal cual lo escribe el usuario: acá tampoco se
    canonicaliza nada (PRD §4).
    """

    cliente: str | None = None
    numero_cliente: str | None = None
    fecha_hora: datetime | None = None
    numero_remito: str | None = None
    comentarios: str | None = None


class FileUrlOut(BaseModel):
    url: str
    expires_in_seconds: int


class ShareLinksIn(BaseModel):
    """Pedido de links para compartir varios remitos de una."""

    #: El tope acompaña al `limit` por defecto del listado ("seleccionar todos
    #: los visibles"): un mensaje de WhatsApp con más links que eso no es un
    #: caso de uso real, y evita firmar cientos de URLs por un request.
    remito_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=100)


class ShareLinkOut(BaseModel):
    """Un remito con su link de descarga de larga duración.

    Lleva los datos que el frontend arma en el mensaje de WhatsApp para que no
    tenga que cruzarlos con el listado.
    """

    id: uuid.UUID
    cliente: str | None
    numero_remito: str | None
    fecha_hora: datetime | None
    url: str
