"""reintroduce share_links

Vuelve el acortador propio de links de WhatsApp (`GET /s/{code}`): un
código corto que redirige a una URL prefirmada de MinIO fresca en cada
click, en vez de mandar la URL prefirmada larga directo al mensaje.

A diferencia de la versión anterior (c3f7a1b9e2d4), el link es PERMANENTE:
no hay `expires_at`. Lo que caduca es la firma fresca que se acuña en cada
redirect (`MINIO_PRESIGNED_EXPIRES_SECONDS`), no el link en sí.

Revision ID: c4d5e6f7a8b9
Revises: d4e6f8a1b3c5
Create Date: 2026-08-14

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4d5e6f7a8b9"
down_revision: Union[str, Sequence[str], None] = "d4e6f8a1b3c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "share_links",
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("minio_key", sa.Text(), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("code"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("share_links")
