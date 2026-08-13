from fastapi import APIRouter

from app.api.v1 import auth, files, remitos, uploads

api_router = APIRouter(prefix="/api/v1")

# `auth` es el único router sin `get_current_user` (junto con `/health`, que
# vive fuera de este prefijo).
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(uploads.router, prefix="/uploads", tags=["uploads"])
api_router.include_router(remitos.router, prefix="/remitos", tags=["remitos"])
# `files` cuelga de /remitos porque PRD §17 define GET /api/v1/remitos/{id}/file-url.
api_router.include_router(files.router, prefix="/remitos", tags=["files"])
