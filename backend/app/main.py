import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import files
from app.api.v1.router import api_router
from app.core.config import settings
from app.services import minio_service

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """MinIO no crea el bucket solo: hay que asegurarlo al arrancar.

    Un fallo acá no debe impedir que la API levante (el healthcheck del
    contenedor de MinIO puede tardar); el error queda logueado y el próximo
    upload volverá a intentarlo.
    """
    try:
        await asyncio.to_thread(minio_service.ensure_bucket)
        logger.info("Bucket %s asegurado", settings.minio_bucket)
    except minio_service.StorageError as exc:
        logger.warning("No se pudo asegurar el bucket al arrancar: %s", exc)
    yield


app = FastAPI(title="Remitos API", version=settings.app_version, lifespan=lifespan)

# La sesión viaja en una cookie httpOnly, así que el navegador manda las
# peticiones con `credentials: "include"` y el origen debe estar en la lista
# explícita: con credenciales, "*" no es válido.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
# Fuera de /api/v1 a propósito: es lo que mantiene el link corto de
# compartir corto (`{public_base_url}/s/{code}`, sin sesión).
app.include_router(files.public_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/version")
async def version() -> dict[str, str]:
    """INF-502/503: la verificación post-deploy compara esto contra el tag
    de la release -- un 200 con la versión vieja es una release que no se
    aplicó, no un éxito."""
    return {"version": settings.app_version}
