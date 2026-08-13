"""Modelos internos del pipeline worker-side. NO se exponen por HTTP."""

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class OCRDocument:
    """Una representación OCR-ready de (parte de) un archivo fuente.

    `page_number` es None cuando el archivo se manda entero al modelo (imagen
    suelta o PDF nativo) y no se puede atribuir el remito a una página.
    """

    data: bytes
    mime_type: str
    page_number: int | None = None


@dataclass
class DeliveryNoteDraft:
    """Un remito normalizado más el contexto del archivo del que salió."""

    source_file_id: uuid.UUID
    cliente: str | None = None
    numero_cliente: str | None = None
    fecha_hora: datetime | None = None
    numero_remito: str | None = None
    comentarios: str | None = None
    page_number: int | None = None
    detection_index: int | None = None
    requires_review: bool = False
    extraction_payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProcessingResult:
    """Rollup del procesamiento de un archivo completo."""

    source_file_status: str
    detected_remitos: int
    remitos: list[dict[str, Any]] = field(default_factory=list)
    error_message: str | None = None
