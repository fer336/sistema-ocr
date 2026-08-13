"""Normalización y validación de la salida del OCR (PRD §6 y §13).

Port directo a Python del contrato JavaScript documentado en PRD §6: el
proveedor puede envolver la respuesta en varias estructuras distintas, así que
primero hay que LOCALIZAR el texto, después limpiarlo, después parsearlo.

Regla crítica (PRD §4): `numero_remito` se preserva EXACTAMENTE como viene.
Sólo `.strip()`. Nada de reestructurar a "B 5001 NNNN", nada de quedarse con
la última parte numérica, nada de sacar espacios internos o ceros iniciales.
"""

import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import ValidationError

from app.schemas.extraction import ALLOWED_KEYS, OCRDeliveryNote
from app.services.ocr_service import OCRResult

#: Hora local en la que el remito imprime `fecha_hora` (decisión cerrada).
LOCAL_TIMEZONE = ZoneInfo("America/Argentina/Buenos_Aires")

#: Formato obligatorio de `fecha_hora` (PRD §4).
FECHA_HORA_FORMAT = "%d/%m/%Y %H:%M"

_FENCE_START_RE = re.compile(r"^```(?:json)?\s*", re.IGNORECASE)
_FENCE_END_RE = re.compile(r"```$", re.IGNORECASE)


@dataclass(frozen=True)
class NormalizedRemito:
    """Un remito validado, listo para persistir."""

    cliente: str | None
    numero_cliente: str | None
    fecha_hora_text: str | None
    numero_remito: str | None
    comentarios: str | None
    fecha_hora_utc: datetime | None
    fecha_hora_valid: bool
    requires_review: bool
    review_reasons: tuple[str, ...]
    detection_index: int

    @property
    def payload(self) -> dict[str, Any]:
        """Lo que se guarda en `extraction_payload` (JSONB)."""
        return {
            "cliente": self.cliente,
            "numero_cliente": self.numero_cliente,
            "fecha_hora": self.fecha_hora_text,
            "numero_remito": self.numero_remito,
            "comentarios": self.comentarios,
            "fecha_hora_valid": self.fecha_hora_valid,
            "requires_review": self.requires_review,
            "review_reasons": list(self.review_reasons),
            "detection_index": self.detection_index,
        }


@dataclass(frozen=True)
class NormalizationResult:
    """Resultado de normalizar UNA respuesta del modelo."""

    error: bool
    remitos: tuple[NormalizedRemito, ...] = ()
    error_type: str | None = None
    message: str | None = None
    raw: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


# --- PRD §6: localizar el texto ------------------------------------------


def extract_text(payload: Any) -> str:
    """Port de `extractText(json)` de PRD §6.

    Recorre en orden las formas de wrapper documentadas y devuelve la primera
    que traiga texto. `''` si ninguna aplica.
    """
    if payload is None:
        return ""
    if isinstance(payload, str):
        return payload
    if not isinstance(payload, dict):
        return ""

    for key in ("text", "output", "response", "result"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value

    content_parts = _dig(payload, "content", "parts")
    text = _first_part_text(content_parts)
    if text:
        return text

    candidates = payload.get("candidates")
    if isinstance(candidates, list) and candidates:
        first = candidates[0]
        if isinstance(first, dict):
            text = _first_part_text(_dig(first, "content", "parts"))
            if text:
                return text

    data_text = _dig(payload, "data", "text")
    if isinstance(data_text, str) and data_text:
        return data_text

    return ""


def _dig(payload: dict[str, Any], *keys: str) -> Any:
    """Equivalente del optional chaining `a?.b?.c` del snippet de PRD §6."""
    current: Any = payload
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _first_part_text(parts: Any) -> str:
    if isinstance(parts, list) and parts:
        first = parts[0]
        if isinstance(first, dict):
            value = first.get("text")
            if isinstance(value, str):
                return value
    return ""


# --- PRD §6: limpiar el texto --------------------------------------------


def clean_json_text(value: Any) -> str:
    """Port de `cleanJsonText(value)` de PRD §6.

    Saca los fences de Markdown y se queda con el substring entre el primer
    `[` y el último `]`, que es lo que salva las respuestas con prosa alrededor
    del array.
    """
    text = str(value or "").strip()
    text = _FENCE_START_RE.sub("", text)
    text = _FENCE_END_RE.sub("", text)
    text = text.strip()

    first_array = text.find("[")
    last_array = text.rfind("]")
    if first_array != -1 and last_array != -1 and last_array > first_array:
        text = text[first_array : last_array + 1]

    return text


# --- PRD §13: validación y criterio de revisión --------------------------


def _normalize_value(row: Any, key: str) -> str | None:
    """`'' | None | ausente` → None; cualquier otra cosa → `str(value)`.

    Es exactamente la regla del snippet de PRD §6, más un `.strip()`: un valor
    con espacios sobrantes en los bordes no es información del remito. Los
    espacios INTERNOS se conservan (PRD §13: "No eliminar espacios internos de
    numero_remito").
    """
    if not isinstance(row, dict) or key not in row:
        return None
    value = row[key]
    if value is None or value == "":
        return None
    text = str(value).strip()
    return text or None


def parse_fecha_hora(value: str | None) -> datetime | None:
    """`DD/MM/YYYY HH:mm` en hora de Buenos Aires → datetime UTC.

    Devuelve None si el formato no es válido: eso marca `requires_review`
    (PRD §13), nunca una excepción que tumbe el procesamiento del archivo.
    """
    if not value:
        return None
    try:
        naive = datetime.strptime(value, FECHA_HORA_FORMAT)
    except ValueError:
        return None
    return naive.replace(tzinfo=LOCAL_TIMEZONE).astimezone(UTC)


def evaluate_review(
    *,
    cliente: str | None,
    numero_cliente: str | None,
    fecha_hora_text: str | None,
    numero_remito: str | None,
    fecha_hora_utc: datetime | None,
) -> tuple[str, ...]:
    """Criterio de revisión de PRD §13.

    `comentarios` puede ser null sin bloquear el procesamiento.
    """
    reasons: list[str] = []
    if numero_remito is None:
        reasons.append("numero_remito_null")
    if numero_cliente is None:
        reasons.append("numero_cliente_null")
    if cliente is None:
        reasons.append("cliente_null")
    if fecha_hora_text is None:
        reasons.append("fecha_hora_null")
    elif fecha_hora_utc is None:
        reasons.append("fecha_hora_formato_invalido")
    return tuple(reasons)


def _build_remito(row: Any, index: int) -> NormalizedRemito:
    normalized = {key: _normalize_value(row, key) for key in ALLOWED_KEYS}

    # Contrato explícito: sólo las 5 claves, todas str|None. Como el dict se
    # construye a partir de ALLOWED_KEYS, `extra="forbid"` no puede fallar
    # acá; la validación existe para que el contrato sea el del schema y no
    # una convención implícita de este módulo.
    validated = OCRDeliveryNote.model_validate(normalized)

    fecha_hora_utc = parse_fecha_hora(validated.fecha_hora)
    reasons = evaluate_review(
        cliente=validated.cliente,
        numero_cliente=validated.numero_cliente,
        fecha_hora_text=validated.fecha_hora,
        numero_remito=validated.numero_remito,
        fecha_hora_utc=fecha_hora_utc,
    )

    return NormalizedRemito(
        cliente=validated.cliente,
        numero_cliente=validated.numero_cliente,
        # numero_remito va tal cual: ya pasó por strip() y NADA más.
        numero_remito=validated.numero_remito,
        fecha_hora_text=validated.fecha_hora,
        comentarios=validated.comentarios,
        fecha_hora_utc=fecha_hora_utc,
        fecha_hora_valid=fecha_hora_utc is not None,
        requires_review=bool(reasons),
        review_reasons=reasons,
        detection_index=index,
    )


# --- Entrada pública ------------------------------------------------------


def normalize_text(raw_text: str) -> NormalizationResult:
    """Normaliza un texto ya localizado (útil para tests con fixtures)."""
    cleaned = clean_json_text(raw_text)
    if not cleaned:
        return NormalizationResult(
            error=True,
            error_type="invalid_json",
            message="El modelo no devolvió texto",
            raw=raw_text,
        )

    try:
        parsed = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError) as exc:
        return NormalizationResult(
            error=True, error_type="invalid_json", message=str(exc), raw=raw_text
        )

    if not isinstance(parsed, list):
        return NormalizationResult(
            error=True,
            error_type="invalid_json",
            message="Model output is not an array",
            raw=raw_text,
        )

    remitos: list[NormalizedRemito] = []
    for index, row in enumerate(parsed):
        try:
            remitos.append(_build_remito(row, index))
        except ValidationError as exc:
            return NormalizationResult(
                error=True,
                error_type="invalid_schema",
                message=str(exc),
                raw=raw_text,
            )

    return NormalizationResult(error=False, remitos=tuple(remitos), raw=raw_text)


def normalize(result: OCRResult | dict[str, Any] | str) -> NormalizationResult:
    """Normaliza la salida cruda del `ocr_service`.

    Acepta un `OCRResult`, el dict crudo del proveedor o directamente el
    texto, porque PRD §6 exige tolerar wrappers distintos según de dónde venga
    la respuesta.
    """
    if isinstance(result, OCRResult):
        raw_text = result.text or extract_text(result.raw)
    elif isinstance(result, dict):
        raw_text = extract_text(result)
    else:
        raw_text = str(result or "")

    return normalize_text(raw_text)
