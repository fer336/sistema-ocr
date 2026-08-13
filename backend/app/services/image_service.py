"""Compresión y optimización de imágenes (PRD §9).

Funciones puras: reciben bytes y devuelven bytes. Sin I/O a MinIO ni a la DB.

Pipeline: corregir orientación EXIF → convertir a RGB → limitar resolución →
búsqueda iterativa de calidad WebP entre IMAGE_START_QUALITY e
IMAGE_MIN_QUALITY apuntando a TARGET_IMAGE_SIZE_KB.

WebP es el único formato que persiste en MinIO (decisión del proyecto: nunca
guardar el original de forma permanente, para no acumular espacio). El
original SÍ se sube transitoriamente para que el worker tenga con qué hacer
OCR, y se borra apenas termina de procesarse -- ver `worker/processor.py`.

El objetivo de 300 KB es aproximado: nunca se baja de IMAGE_MIN_QUALITY,
porque un remito ilegible rompe el OCR y ese es el punto de todo el sistema.
"""

import io
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import settings

#: MIME types de imagen aceptados en el upload.
#:
#: HEIC/HEIF quedan fuera a propósito: Pillow no los abre sin `pillow-heif` y
#: prometer un formato que después falla es peor que rechazarlo en la puerta.
#: Safari/iOS convierte a JPEG al subir por `<input type="file">`, así que en
#: la práctica no bloquea el flujo de cámara del PRD §8.
SUPPORTED_IMAGE_MIME_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/tiff",
    "image/bmp",
    "image/gif",
}

PREVIEW_MAX_SIZE = (600, 600)
PREVIEW_QUALITY = 70


class ImageProcessingError(Exception):
    """El archivo no es una imagen legible."""


@dataclass(frozen=True)
class OptimizedImage:
    """Resultado de optimizar una imagen."""

    data: bytes
    content_type: str
    extension: str
    width: int
    height: int
    quality: int | None
    recompressed: bool


def _open(image_bytes: bytes) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(image_bytes))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ImageProcessingError(f"No se pudo abrir la imagen: {exc}") from exc
    return image


def _prepare(image: Image.Image, max_size: tuple[int, int]) -> Image.Image:
    """EXIF → RGB → resize (sólo hacia abajo; `thumbnail` no amplía)."""
    image = ImageOps.exif_transpose(image) or image
    if image.mode != "RGB":
        # Cubre L, P, RGBA, CMYK y 16-bit: JPEG sólo acepta RGB/L y la
        # transparencia no aporta nada en un remito escaneado.
        image = image.convert("RGB")
    image.thumbnail(max_size, Image.Resampling.LANCZOS)
    return image


def _encode_jpeg(image: Image.Image, quality: int) -> bytes:
    buffer = io.BytesIO()
    image.save(
        buffer,
        format="JPEG",
        quality=quality,
        optimize=True,
        progressive=True,
        subsampling=1,
    )
    return buffer.getvalue()


def _encode_webp(image: Image.Image, quality: int) -> bytes:
    buffer = io.BytesIO()
    # method=6: compresión más lenta pero más chica a igual calidad -- corre
    # una sola vez por imagen subida, no es un costo recurrente.
    image.save(buffer, format="WEBP", quality=quality, method=6)
    return buffer.getvalue()


def optimize_image(
    image_bytes: bytes,
    *,
    target_bytes: int | None = None,
    max_size: tuple[int, int] | None = None,
    start_quality: int | None = None,
    min_quality: int | None = None,
) -> OptimizedImage:
    """Devuelve la mejor versión WebP ≤ target sin bajar de `min_quality`.

    Siempre devuelve WebP -- es el único formato que persiste en MinIO. Si la
    imagen ya es WebP, ya pesa menos del objetivo, y no necesita reescalado ni
    corrección de orientación, se devuelve tal cual (PRD §9: "si una imagen ya
    pesa menos de 300 KB y tiene calidad suficiente, no es necesario
    recomprimirla"). Cualquier otro caso se recodifica a WebP, aunque sea
    liviana, porque JPEG/PNG/etc. no pueden quedar guardados.
    """
    target = target_bytes if target_bytes is not None else settings.target_image_size_bytes
    bounds = max_size or (settings.image_max_width, settings.image_max_height)
    q_start = start_quality if start_quality is not None else settings.image_start_quality
    q_min = min_quality if min_quality is not None else settings.image_min_quality

    original = _open(image_bytes)
    original_size = original.size
    needs_resize = original_size[0] > bounds[0] or original_size[1] > bounds[1]
    has_exif_rotation = original.getexif().get(0x0112, 1) not in (0, 1)
    is_already_webp = (original.format or "").upper() == "WEBP"

    if (
        is_already_webp
        and len(image_bytes) <= target
        and not needs_resize
        and not has_exif_rotation
    ):
        return OptimizedImage(
            data=image_bytes,
            content_type="image/webp",
            extension=".webp",
            width=original_size[0],
            height=original_size[1],
            quality=None,
            recompressed=False,
        )

    image = _prepare(original, bounds)

    # Búsqueda binaria de calidad: arranca en q_start y biseca hacia el
    # objetivo. Se guarda siempre el mejor candidato ≤ target; si ninguno
    # entra, se devuelve el de q_min (legibilidad antes que tamaño).
    best = _encode_webp(image, q_start)
    best_quality = q_start
    if len(best) > target and q_start > q_min:
        low, high = q_min, q_start
        candidate = None
        candidate_quality = None
        while low <= high:
            mid = (low + high) // 2
            encoded = _encode_webp(image, mid)
            if len(encoded) <= target:
                candidate, candidate_quality = encoded, mid
                low = mid + 1
            else:
                high = mid - 1
        if candidate is not None:
            best, best_quality = candidate, candidate_quality  # type: ignore[assignment]
        else:
            best, best_quality = _encode_webp(image, q_min), q_min

    return OptimizedImage(
        data=best,
        content_type="image/webp",
        extension=".webp",
        width=image.size[0],
        height=image.size[1],
        quality=best_quality,
        recompressed=True,
    )


def make_preview(image_bytes: bytes, *, max_size: tuple[int, int] = PREVIEW_MAX_SIZE) -> OptimizedImage:
    """Miniatura liviana en WebP para listados y galerías."""
    image = _prepare(_open(image_bytes), max_size)
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=PREVIEW_QUALITY, method=4)
    return OptimizedImage(
        data=buffer.getvalue(),
        content_type="image/webp",
        extension=".webp",
        width=image.size[0],
        height=image.size[1],
        quality=PREVIEW_QUALITY,
        recompressed=True,
    )


def to_ocr_jpeg(image_bytes: bytes) -> bytes:
    """Representación estable para enviar a Gemini.

    Normaliza orientación y modo de color y acota la resolución, pero con una
    calidad más alta que la versión de almacenamiento: acá el objetivo no es
    ahorrar bytes sino no perder trazos finos del remito.
    """
    image = _prepare(_open(image_bytes), (settings.image_max_width, settings.image_max_height))
    return _encode_jpeg(image, max(settings.image_start_quality, 90))
