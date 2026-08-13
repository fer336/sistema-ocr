"""drop share_links

El acortador propio (`GET /s/{code}`) se dio de baja: compartir por
WhatsApp ahora manda la URL prefirmada de MinIO directo en el mensaje
(7 días de vencimiento, igual que antes), sin la capa de código corto +
redirect. Ver docs/DEVIATIONS.md si aplica, y el commit que acompaña
esta migración.

Revision ID: d4e6f8a1b3c5
Revises: c3f7a1b9e2d4
Create Date: 2026-08-14

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4e6f8a1b3c5"
down_revision: Union[str, Sequence[str], None] = "c3f7a1b9e2d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_index("ix_share_links_expires_at", table_name="share_links")
    op.drop_table("share_links")


def downgrade() -> None:
    """Downgrade schema."""
    import sqlalchemy as sa

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
