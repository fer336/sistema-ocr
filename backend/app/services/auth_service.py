"""Login con Google + sesión propia en JWT.

Separación deliberada: el ID token de Google se verifica UNA sola vez, en el
login. A partir de ahí la sesión es un JWT propio (HS256, firmado con
`jwt_secret_key`) guardado en una cookie httpOnly. Validar el token de Google
en cada request implicaría un round-trip a los JWKS de Google por request y
ataría la duración de la sesión a la del token de Google (1 hora).
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import User
from app.repositories import users as users_repo

_ALGORITHM = "HS256"
_GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


class AuthError(Exception):
    """Credencial inválida (401)."""


class ForbiddenEmailError(Exception):
    """Cuenta Google válida pero fuera del allowlist (403)."""


def verify_google_id_token(token: str) -> dict[str, Any]:
    """Verifica firma, audiencia, emisor y expiración del ID token de Google.

    `verify_oauth2_token` valida firma contra los certificados públicos de
    Google, `aud == google_oauth_client_id` y `exp`. Chequeamos `iss` y
    `email_verified` aparte porque la librería no lo hace por nosotros.
    """
    if not token:
        raise AuthError("Falta el id_token de Google")
    if not settings.google_oauth_client_id:
        raise AuthError("GOOGLE_OAUTH_CLIENT_ID no está configurado en el backend")

    try:
        claims = google_id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            settings.google_oauth_client_id,
        )
    except ValueError as exc:
        raise AuthError(f"ID token de Google inválido: {exc}") from exc

    if claims.get("iss") not in _GOOGLE_ISSUERS:
        raise AuthError("Emisor del ID token no reconocido")
    if not claims.get("email"):
        raise AuthError("El ID token no incluye email")
    if not claims.get("email_verified", False):
        raise AuthError("El email de la cuenta de Google no está verificado")

    return claims


def assert_email_allowed(email: str) -> None:
    """Allowlist opcional: vacía = cualquier cuenta Google verificada entra."""
    allowed = settings.allowed_google_emails_list
    if not allowed:
        return
    if email.strip().lower() not in allowed:
        raise ForbiddenEmailError(f"El email {email} no está autorizado para esta aplicación")


async def get_or_create_user(db: AsyncSession, claims: dict[str, Any]) -> User:
    """Busca por `sub` (estable), luego por email (cuenta que cambió de mail).

    Actualiza nombre/avatar/last_login_at en cada login para que el perfil no
    quede congelado en el estado del primer ingreso.
    """
    google_sub = str(claims["sub"])
    email = str(claims["email"])
    name = claims.get("name")
    avatar_url = claims.get("picture")

    user = await users_repo.get_by_google_sub(db, google_sub)
    if user is None:
        user = await users_repo.get_by_email(db, email)
        if user is not None:
            user.google_sub = google_sub

    if user is None:
        user = await users_repo.create(
            db, email=email, google_sub=google_sub, name=name, avatar_url=avatar_url
        )
    else:
        user.email = email
        if name:
            user.name = name
        if avatar_url:
            user.avatar_url = avatar_url

    user.last_login_at = datetime.now(UTC)
    await db.flush()
    return user


def create_session_jwt(user: User) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_expires_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=_ALGORITHM)


def decode_session_jwt(token: str) -> uuid.UUID:
    """Devuelve el user_id de una cookie de sesión válida, o lanza AuthError."""
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise AuthError(f"Sesión inválida: {exc}") from exc

    subject = payload.get("sub")
    if not subject:
        raise AuthError("Sesión sin sujeto")
    try:
        return uuid.UUID(subject)
    except ValueError as exc:
        raise AuthError("Sesión con sujeto malformado") from exc
