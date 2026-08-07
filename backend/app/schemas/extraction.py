from pydantic import BaseModel


class ExtractedDeliveryNote(BaseModel):
    """Únicos campos que el OCR extrae del remito.

    Decisión del usuario: fecha, hora, número de remito, número y nombre del
    cliente. NADA MÁS (se eliminó dirección, proveedor, vendedor, CUIT,
    condición de venta, obra, firmado e items).
    """

    document_number: str | None
    document_date: str | None
    document_time: str | None
    client_number: str | None
    client_name: str | None
    confidence: float
