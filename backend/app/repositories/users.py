from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User


async def get_by_google_sub(db: AsyncSession, google_sub: str) -> User | None:
    result = await db.execute(select(User).where(User.google_sub == google_sub))
    return result.scalars().first()


async def get_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalars().first()


async def create(
    db: AsyncSession,
    *,
    email: str,
    google_sub: str,
    name: str | None = None,
    avatar_url: str | None = None,
) -> User:
    user = User(email=email, google_sub=google_sub, name=name, avatar_url=avatar_url)
    db.add(user)
    await db.flush()
    return user
