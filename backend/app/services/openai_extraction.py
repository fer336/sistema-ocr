import base64
from functools import lru_cache

from openai import AsyncOpenAI

from app.core.config import settings
from app.schemas.extraction import ExtractedDeliveryNote

_MODEL = settings.openai_model


@lru_cache(maxsize=1)
def _get_client() -> AsyncOpenAI:
    kwargs: dict = {"api_key": settings.openai_api_key}
    if settings.openai_base_url:
        kwargs["base_url"] = settings.openai_base_url
    return AsyncOpenAI(**kwargs)


_EXTRACTION_PROMPT_TEMPLATE = """
Esta imagen es un remito de entrega de materiales eléctricos. Extraé ÚNICAMENTE
estos cinco datos en el formato solicitado:

1. document_date: fecha de emisión del remito en formato AAAA-MM-DD (ejemplo: "2026-06-22").
2. document_time: hora de emisión en formato HH:MM (ejemplo: "10:35"). Si la imagen
   no muestra hora, usá null.
3. document_number: número del remito en formato canónico: prefijo "B", luego "5001",
   luego los dígitos del número impreso, todo separado por un solo espacio
   (ejemplo: "B 5001 00123456"). Transcribilo SIN guiones ni otros separadores, y no
   omitás los prefijos "B" ni "5001". Si el número impreso no sigue ese patrón,
   transcribilo literalmente tal cual aparece.
4. client_number: número de cliente tal como está impreso (ej.: "12299").
5. client_name: nombre del cliente tal cual está impreso (ej.: "CONSORCIO EDIF KALEM").

Reglas:
- No inventes información: si un dato no es legible o no está presente, usá null.
- No mezcles datos de un remito con otro.
- Solo estos cinco campos: no extraigas dirección, localidad, proveedor, vendedor,
  CUIT, condición de venta, obra, firmas ni artículos.
- Si el texto es dudoso o poco legible, bajá el valor de "confidence" (0.0 a 1.0).
""".strip()


def _image_data_url(image_bytes: bytes, mime_type: str = "image/png") -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


async def extract_delivery_note(image_bytes: bytes) -> ExtractedDeliveryNote:
    response = await _get_client().chat.completions.parse(
        model=_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _EXTRACTION_PROMPT_TEMPLATE},
                    {"type": "image_url", "image_url": {"url": _image_data_url(image_bytes)}},
                ],
            }
        ],
        response_format=ExtractedDeliveryNote,
    )
    parsed = response.choices[0].message.parsed
    if parsed is None:
        raise ValueError("OpenAI no devolvió una extracción válida")
    return parsed