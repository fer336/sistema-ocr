from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_session
from app.core.config import settings
from app.db.models import User
from app.schemas.auth import GoogleLoginRequest, UserOut
from app.services import auth_service

router = APIRouter()


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
        max_age=settings.jwt_expires_minutes * 60,
        path="/",
    )


@router.post("/google", response_model=UserOut)
async def login_with_google(
    payload: GoogleLoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_session),
) -> User:
    """Único punto donde se valida un token de Google.

    A partir de acá la sesión es la cookie httpOnly con el JWT propio.
    """
    try:
        claims = auth_service.verify_google_id_token(payload.id_token)
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    try:
        auth_service.assert_email_allowed(str(claims["email"]))
    except auth_service.ForbiddenEmailError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    user = await auth_service.get_or_create_user(db, claims)
    await db.commit()
    await db.refresh(user)

    _set_session_cookie(response, auth_service.create_session_jwt(user))
    return user


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.post("/logout")
async def logout(response: Response) -> dict[str, str]:
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
    )
    return {"status": "ok"}
