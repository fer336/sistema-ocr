from collections.abc import AsyncIterator

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import User
from app.db.session import get_db
from app.services import auth_service


async def get_session() -> AsyncIterator[AsyncSession]:
    async for session in get_db():
        yield session


async def get_current_user(
    request: Request, db: AsyncSession = Depends(get_session)
) -> User:
    """Sesión = cookie httpOnly con JWT propio (ver `auth_service`).

    Se aplica a todos los routers `/api/v1/*` salvo `/api/v1/auth/*` y
    `/health`. 401 si falta la cookie, si el JWT no valida/expiró, o si el
    usuario ya no existe en la base.
    """
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="No hay sesión activa"
        )

    try:
        user_id = auth_service.decode_session_jwt(token)
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="El usuario de la sesión ya no existe"
        )
    return user
