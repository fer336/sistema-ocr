"""Integración con Gemini (PRD §20).

Responsabilidad ÚNICA: recibir el documento, construir la solicitud, aplicar
el prompt y devolver la respuesta cruda. Nada de parseo, validación ni
persistencia: eso es de `extraction_service`. Esa frontera es lo que permite
cambiar de proveedor sin tocar el resto del sistema (PRD §29).
"""

import asyncio
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from google import genai
from google.genai import types as genai_types

from app.core.config import settings

#: Prompt de extracción, PRD §5. `comentarios` reinterpretado a pedido del
#: usuario: no es literalmente el campo "Comentarios" del formulario, es la
#: referencia descriptiva (obra, dirección del cliente, sector) que suele
#: aparecer debajo de cliente/numero_cliente -- distinto de la dirección del
#: EMISOR del remito, que nunca va acá.
EXTRACTION_PROMPT = """Analiza el archivo recibido y detecta todos los remitos visibles.

Por cada remito extrae únicamente:

- cliente
- numero_cliente
- fecha_hora
- numero_remito
- comentarios

No extraigas ninguna otra información.

Regla CRÍTICA para numero_remito:

- Debe incluir el identificador COMPLETO visible del remito.
- Si el documento muestra algo como "B 5001 00139454", el valor correcto es exactamente "B 5001 00139454".
- No devuelvas solamente la última parte numérica.
- Conserva letra, punto de venta/sucursal, espacios, guiones y ceros iniciales tal como aparecen.

Regla para comentarios:

- El campo "comentarios" representa la referencia adicional asociada al cliente o al remito.
- Puede contener una dirección, nombre de obra, nombre de proyecto, ubicación, sucursal, sector o cualquier texto descriptivo que permita identificar a qué obra, lugar o referencia corresponde el remito.
- En el formato actual, normalmente aparece inmediatamente debajo de la línea que contiene numero_cliente y cliente.

Ejemplo:

12299 - CONSORCIO EDIF KALEM
BOULEVARD C. DARWIN ESQ FRANCISCO P. MORENO

Debe producir:

"comentarios": "BOULEVARD C. DARWIN ESQ FRANCISCO P. MORENO"

- No confundas comentarios con la dirección del EMISOR del remito, datos de contacto del proveedor, CUIT, vendedor, artículos, productos, firma, localidad, condición de venta u otros textos administrativos.
- La prioridad es extraer la referencia descriptiva asociada directamente al cliente/remito.
- Si existen varias líneas consecutivas que claramente forman parte de la misma referencia, únelas separadas por un espacio.
- No inventes ni completes información.
- Si no existe una referencia asociada al cliente/remito o no puede leerse de forma confiable, utiliza null.

No inventes datos.
Si un campo no puede leerse de forma confiable, utiliza null.

Mantén numero_cliente y numero_remito como strings.
Conserva los ceros iniciales.

fecha_hora debe utilizar DD/MM/YYYY HH:mm.

Si existen múltiples remitos, devuelve todos.
Si no hay ningún remito reconocible, devuelve un array vacío.

Respondé SOLO con JSON válido, sin Markdown, sin explicación, sin texto adicional.

Schema esperado:
[
  {
    "cliente": string|null,
    "numero_cliente": string|null,
    "fecha_hora": string|null,
    "numero_remito": string|null,
    "comentarios": string|null
  }
]"""


class OCRError(Exception):
    """Fallo al invocar al proveedor de OCR."""


@dataclass(frozen=True)
class OCRResult:
    """Salida cruda del modelo, sin interpretar.

    `raw` conserva la respuesta completa serializada por si hace falta
    diagnosticar un wrapper inesperado (PRD §6 documenta varios).
    """

    text: str
    model: str
    raw: dict[str, Any] = field(default_factory=dict)


@lru_cache(maxsize=1)
def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise OCRError("GEMINI_API_KEY no está configurado")
    return genai.Client(api_key=settings.gemini_api_key)


def _response_to_dict(response: Any) -> dict[str, Any]:
    for attr in ("model_dump", "to_json_dict", "dict"):
        method = getattr(response, attr, None)
        if callable(method):
            try:
                value = method()
            except Exception:  # noqa: BLE001 - sólo es material de diagnóstico
                continue
            if isinstance(value, dict):
                return value
    return {}


async def extract(document_bytes: bytes, mime_type: str, *, prompt: str = EXTRACTION_PROMPT) -> OCRResult:
    """Manda un documento (imagen o PDF) al modelo y devuelve su salida cruda.

    Gemini acepta PDF nativo, así que un PDF de pocas páginas puede enviarse
    entero; el llamador decide si rasteriza (ver `document_processing`).
    """
    client = _get_client()
    contents = [
        genai_types.Part.from_bytes(data=document_bytes, mime_type=mime_type),
        genai_types.Part.from_text(text=prompt),
    ]

    def _call() -> Any:
        return client.models.generate_content(
            model=settings.ocr_model,
            contents=contents,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0,
            ),
        )

    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(_call), timeout=settings.ocr_timeout_seconds
        )
    except TimeoutError as exc:
        raise OCRError(f"Timeout de {settings.ocr_timeout_seconds}s llamando a {settings.ocr_model}") from exc
    except Exception as exc:  # noqa: BLE001 - cualquier fallo del SDK es un OCRError
        raise OCRError(f"Error llamando a {settings.ocr_model}: {exc}") from exc

    return OCRResult(
        text=getattr(response, "text", None) or "",
        model=settings.ocr_model,
        raw=_response_to_dict(response),
    )
