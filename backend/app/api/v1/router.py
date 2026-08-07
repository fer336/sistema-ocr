from fastapi import APIRouter

from app.api.v1 import clients, internal, remitos

api_router = APIRouter(prefix="/api")
api_router.include_router(clients.router, prefix="/clients", tags=["clients"])
api_router.include_router(remitos.router, prefix="/remitos", tags=["remitos"])
api_router.include_router(internal.router, prefix="/internal", tags=["internal"])
