"""Manejo de PDF (PRD §21). Renombrado de `services/pdf.py`.

Este módulo sólo rasteriza: un PDF entra y salen imágenes. La compresión y el
peso objetivo son responsabilidad de `image_service`, que ya resuelve eso para
las fotos — un PDF no necesita un pipeline propio.
"""

# `import fitz` es el alias histórico y ya emite DeprecationWarning: PyMuPDF
# lo va a quitar. El nombre real del paquete es `pymupdf`.
import pymupdf as fitz

DEFAULT_DPI = 200
PREVIEW_DPI = 90


def pdf_to_images(pdf_bytes: bytes, *, dpi: int = DEFAULT_DPI) -> list[bytes]:
    """Rasteriza cada página de un PDF a PNG.

    Es lo que permite mantener `page_number` por remito: cada página se manda
    al modelo por separado y el índice de página se conserva en la fila.
    """
    zoom = dpi / 72
    matrix = fitz.Matrix(zoom, zoom)
    images: list[bytes] = []
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        for page in doc:
            pix = page.get_pixmap(matrix=matrix)
            images.append(pix.tobytes("png"))
    return images


def pdf_first_page_image(pdf_bytes: bytes, *, dpi: int = PREVIEW_DPI) -> bytes:
    """Primera página rasterizada a PNG.

    Con el `dpi` por defecto alcanza para la miniatura del listado; con
    `DEFAULT_DPI` es la base de la copia optimizada que se guarda en MinIO.
    """
    zoom = dpi / 72
    matrix = fitz.Matrix(zoom, zoom)
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        if doc.page_count == 0:
            raise ValueError("El PDF no tiene páginas")
        pix = doc.load_page(0).get_pixmap(matrix=matrix)
        return pix.tobytes("png")
