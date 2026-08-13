"""simplify delivery notes

Elimina la tabla delivery_note_items y las columnas de delivery_notes que el
usuario dejó de usar: el OCR ahora extrae SOLO fecha, hora, número de remito,
número y nombre del cliente (decisión del usuario, 2026-08-07).

Revision ID: e84bf56e8e82
Revises: 807c07f3b277
Create Date: 2026-08-07 03:11:16.561868

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e84bf56e8e82'
down_revision: Union[str, Sequence[str], None] = '807c07f3b277'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DROPPED_COLUMNS = [
    "address",
    "locality",
    "supplier_name",
    "seller_name",
    "tax_id",
    "payment_condition",
    "work_reference",
    "crop_index",
    "signed",
    "raw_ocr_text",
]


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_table("delivery_note_items")
    for column in _DROPPED_COLUMNS:
        if column == "signed":
            continue
        op.drop_column("delivery_notes", column)
    op.drop_column("delivery_notes", "signed")


def downgrade() -> None:
    """Downgrade schema."""
    for column in _DROPPED_COLUMNS:
        # `signed` y `crop_index` se re-crean abajo con su tipo real (boolean /
        # integer). Sin este skip el downgrade intentaba agregarlos dos veces y
        # moría con DuplicateColumnError.
        if column in ("signed", "crop_index"):
            continue
        op.add_column(
            "delivery_notes",
            sa.Column(column, sa.Text(), nullable=True),
        )
    op.add_column(
        "delivery_notes",
        sa.Column("signed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("delivery_notes", sa.Column("crop_index", sa.Integer(), nullable=True))
    op.create_table(
        "delivery_note_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("delivery_note_id", sa.UUID(), nullable=False),
        sa.Column("line_number", sa.Integer(), nullable=True),
        sa.Column("product_code", sa.Text(), nullable=True),
        sa.Column("quantity", sa.Numeric(precision=12, scale=3), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("brand", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Numeric(precision=5, scale=4), nullable=True),
        sa.ForeignKeyConstraint(["delivery_note_id"], ["delivery_notes.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
