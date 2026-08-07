from collections.abc import AsyncIterator

from fastapi import Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db


async def get_session() -> AsyncIterator[AsyncSession]:
    async for session in get_db():
        yield session


async def require_internal_token(authorization: str | None = Header(default=None)) -> None:
    expected = f"Bearer {settings.internal_api_token}"
    if authorization != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal token")
