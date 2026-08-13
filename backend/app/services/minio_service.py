"""Adaptador de almacenamiento de objetos (MinIO / S3 compatible).

El dominio no debe depender del SDK de MinIO (PRD §29): todo lo que el resto
de la aplicación necesita son keys (`str`) y bytes. Este módulo es la única
frontera con `minio.Minio`.
"""

import io
import uuid
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import PurePosixPath

from minio import Minio

from app.core.config import settings

ORIGINALS_PREFIX = "originals"
OPTIMIZED_PREFIX = "optimized"
PREVIEWS_PREFIX = "previews"


class StorageError(Exception):
    """Fallo al hablar con MinIO.

    Es el ÚNICO error que este módulo deja escapar. El SDK no tiene una
    jerarquía propia para los fallos de red: un MinIO caído o mal apuntado
    levanta `urllib3.exceptions.MaxRetryError`, que no es un `S3Error`. Si se
    filtrara, el startup del backend/worker moriría (en vez de degradarse) y un
    upload devolvería 500 en lugar de un error por archivo.
    """


@lru_cache(maxsize=1)
def get_client() -> Minio:
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
        region=settings.minio_region or None,
    )


def ensure_bucket() -> None:
    """Crea el bucket si no existe. MinIO NO lo crea solo.

    Se llama en el startup del backend y del worker; es idempotente.
    """
    client = get_client()
    try:
        if not client.bucket_exists(settings.minio_bucket):
            client.make_bucket(settings.minio_bucket)
    except Exception as exc:  # noqa: BLE001 - ver docstring de StorageError
        raise StorageError(f"No se pudo asegurar el bucket {settings.minio_bucket}: {exc}") from exc


# --- Construcción de keys (PRD §10) --------------------------------------
# originals/{yyyy}/{mm}/{source_file_uuid}/archivo-original.ext
# optimized/{yyyy}/{mm}/{source_file_uuid}/archivo-optimizado.jpg
# previews/{yyyy}/{mm}/{source_file_uuid}/preview.webp
#
# La ruta física NO depende del cliente: corregir el nombre/número de cliente
# no debe implicar mover objetos.


def _date_segments(moment: datetime | None = None) -> tuple[str, str]:
    moment = moment or datetime.now()
    return f"{moment.year:04d}", f"{moment.month:02d}"


def _safe_extension(filename: str) -> str:
    suffix = PurePosixPath(filename).suffix.lower()
    # Nunca se confía en el nombre original como path (PRD §22): sólo se
    # conserva una extensión corta y alfanumérica, si la hay.
    if len(suffix) > 10 or not suffix[1:].isalnum():
        return ""
    return suffix


def original_key(source_file_id: uuid.UUID, original_filename: str, moment: datetime | None = None) -> str:
    year, month = _date_segments(moment)
    ext = _safe_extension(original_filename)
    return f"{ORIGINALS_PREFIX}/{year}/{month}/{source_file_id}/original{ext}"


def optimized_key(source_file_id: uuid.UUID, extension: str = ".jpg", moment: datetime | None = None) -> str:
    year, month = _date_segments(moment)
    return f"{OPTIMIZED_PREFIX}/{year}/{month}/{source_file_id}/optimized{extension}"


def preview_key(source_file_id: uuid.UUID, extension: str = ".webp", moment: datetime | None = None) -> str:
    year, month = _date_segments(moment)
    return f"{PREVIEWS_PREFIX}/{year}/{month}/{source_file_id}/preview{extension}"


# --- Operaciones ----------------------------------------------------------


def put_object(key: str, data: bytes, content_type: str) -> str:
    client = get_client()
    try:
        client.put_object(
            settings.minio_bucket,
            key,
            io.BytesIO(data),
            length=len(data),
            content_type=content_type,
        )
    except Exception as exc:  # noqa: BLE001 - ver docstring de StorageError
        raise StorageError(f"No se pudo subir {key}: {exc}") from exc
    return key


def get_object_bytes(key: str) -> bytes:
    client = get_client()
    response = None
    try:
        response = client.get_object(settings.minio_bucket, key)
        return response.read()
    except Exception as exc:  # noqa: BLE001 - ver docstring de StorageError
        raise StorageError(f"No se pudo leer {key}: {exc}") from exc
    finally:
        if response is not None:
            response.close()
            response.release_conn()


def remove_object(key: str) -> None:
    client = get_client()
    try:
        client.remove_object(settings.minio_bucket, key)
    except Exception as exc:  # noqa: BLE001 - ver docstring de StorageError
        raise StorageError(f"No se pudo borrar {key}: {exc}") from exc


def presigned_get_url(
    key: str,
    expires_seconds: int | None = None,
    download_filename: str | None = None,
) -> str:
    """URL temporal de descarga. El bucket permanece privado (PRD §22).

    `download_filename` fuerza `Content-Disposition: attachment` (vía
    `response-content-disposition`, parte de la firma) en vez de dejar que el
    navegador decida mostrarla inline -- lo usa el botón "Descargar", no el
    de "Ver" (que sí quiere abrir el archivo en el visor, no bajarlo).
    """
    client = get_client()
    expires = timedelta(seconds=expires_seconds or settings.minio_presigned_expires_seconds)
    response_headers = (
        {"response-content-disposition": f'attachment; filename="{download_filename}"'}
        if download_filename
        else None
    )
    try:
        return client.presigned_get_object(
            settings.minio_bucket, key, expires=expires, response_headers=response_headers
        )
    except Exception as exc:  # noqa: BLE001 - ver docstring de StorageError
        raise StorageError(f"No se pudo firmar {key}: {exc}") from exc
