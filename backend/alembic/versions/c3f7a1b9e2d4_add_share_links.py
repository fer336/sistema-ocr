"""add share_links

Tabla para el acortador propio de links de WhatsApp (`GET /s/{code}`): un
código corto que redirige a una URL prefirmada de MinIO fresca en cada
click, en vez de mandar la URL prefirmada larga directo al mensaje.

Revision ID: c3f7a1b9e2d4
Revises: b1c2d3e4f5a6
Create Date: 2026-08-13

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3f7a1b9e2d4"
down_revision: Union[str, Sequence[str], None] = "b1c2d3e4f5a6"
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
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("code"),
    )
    op.create_index("ix_share_links_expires_at", "share_links", ["expires_at"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_share_links_expires_at", table_name="share_links")
    op.drop_table("share_links")
