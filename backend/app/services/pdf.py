import fitz


def pdf_to_images(pdf_bytes: bytes, *, dpi: int = 200) -> list[bytes]:
    """Rasteriza cada página de un PDF a PNG.

    Es el único paso del pipeline que no se puede hacer con nodos nativos de
    n8n (no rasterizan PDF a imagen, solo extraen texto/metadata), por eso
    vive acá en vez de en el workflow.
    """
    zoom = dpi / 72
    matrix = fitz.Matrix(zoom, zoom)
    images: list[bytes] = []
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        for page in doc:
            pix = page.get_pixmap(matrix=matrix)
            images.append(pix.tobytes("png"))
    return images
