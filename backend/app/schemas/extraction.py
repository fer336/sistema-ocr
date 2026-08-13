from pydantic import BaseModel, ConfigDict

#: Únicas claves aceptadas del modelo (PRD §4 / §13). El orden importa: es el
#: que se usa para construir el payload normalizado.
ALLOWED_KEYS: tuple[str, ...] = (
    "cliente",
    "numero_cliente",
    "fecha_hora",
    "numero_remito",
    "comentarios",
)


class OCRDeliveryNote(BaseModel):
    """Contrato de un remito tal como lo devuelve el OCR (PRD §13).

    `extra="forbid"`: no se aceptan claves adicionales del modelo. Todos los
    campos son `str | None` — `numero_cliente` y `numero_remito` NUNCA se
    convierten a número, porque eso perdería los ceros iniciales y los
    prefijos ("B 5001 00139454").
    """

    model_config = ConfigDict(extra="forbid")

    cliente: str | None = None
    numero_cliente: str | None = None
    fecha_hora: str | None = None
    numero_remito: str | None = None
    comentarios: str | None = None
