"""rebuild for minio + gemini + google oauth

Migración destructiva y limpia: la base es solo de desarrollo y no hay datos
que preservar (decisión del usuario). Reconstruye el esquema para la
arquitectura de PRD.md:

- se elimina `clients` (cliente/numero_cliente viven en `delivery_notes`);
- se crea `users` (login con Google);
- `source_files` deja de referenciar Google Drive y pasa a MinIO + sha256;
- `delivery_notes` pasa a los cinco campos del PRD §4 en español.

Revision ID: b1c2d3e4f5a6
Revises: e84bf56e8e82
Create Date: 2026-08-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, Sequence[str], None] = "e84bf56e8e82"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # --- users (nuevo) ----------------------------------------------------
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("google_sub", sa.String(length=255), nullable=False),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("google_sub"),
    )

    # --- delivery_notes: se reconstruye por completo -----------------------
    # Es más limpio (y equivalente, al no haber datos) que 12 ALTER TABLE.
    op.drop_index("ix_delivery_notes_client_document", table_name="delivery_notes")
    op.drop_table("delivery_notes")
    op.drop_table("clients")

    # --- source_files: Drive -> MinIO -------------------------------------
    # Las filas existentes apuntan a archivos de Google Drive y no tienen
    # binario en MinIO ni sha256: son inservibles con la arquitectura nueva.
    # Se vacían para poder agregar `sha256 NOT NULL UNIQUE` (migración
    # destructiva acordada; la base es solo de desarrollo).
    op.execute("DELETE FROM source_files")

    # El UNIQUE de drive_file_id cae junto con la columna (Postgres dropea
    # las constraints que dependen de ella).
    op.drop_column("source_files", "drive_file_id")
    op.drop_column("source_files", "original_drive_link")

    op.add_column(
        "source_files",
        sa.Column("mime_type", sa.String(length=100), nullable=False, server_default="application/octet-stream"),
    )
    op.add_column(
        "source_files",
        sa.Column("original_size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.add_column("source_files", sa.Column("optimized_size_bytes", sa.BigInteger(), nullable=True))
    op.add_column("source_files", sa.Column("sha256", sa.CHAR(length=64), nullable=False))
    op.add_column("source_files", sa.Column("minio_original_key", sa.Text(), nullable=True))
    op.add_column("source_files", sa.Column("minio_optimized_key", sa.Text(), nullable=True))
    op.add_column("source_files", sa.Column("minio_preview_key", sa.Text(), nullable=True))
    op.add_column("source_files", sa.Column("uploaded_by", sa.UUID(), nullable=True))
    # Marca de cuándo un worker reclamó el archivo: sin esto no hay forma de
    # recuperar filas que quedaron en 'processing' porque el worker murió.
    op.add_column(
        "source_files", sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True)
    )

    op.create_unique_constraint("uq_source_files_sha256", "source_files", ["sha256"])
    op.create_foreign_key(
        "fk_source_files_uploaded_by_users",
        "source_files",
        "users",
        ["uploaded_by"],
        ["id"],
    )

    # `server_default` sólo existía para poder agregar columnas NOT NULL sobre
    # filas preexistentes; el default real lo pone la aplicación.
    op.alter_column("source_files", "mime_type", server_default=None)
    op.alter_column("source_files", "original_size_bytes", server_default=None)

    # created_at/processed_at pasan a TIMESTAMPTZ (PRD §15).
    op.alter_column(
        "source_files",
        "created_at",
        type_=sa.DateTime(timezone=True),
        existing_nullable=False,
        existing_server_default=sa.text("now()"),
    )
    op.alter_column(
        "source_files",
        "processed_at",
        type_=sa.DateTime(timezone=True),
        existing_nullable=True,
    )
    op.alter_column(
        "source_files",
        "status",
        existing_type=sa.String(length=30),
        existing_nullable=False,
        server_default="uploaded",
    )

    # --- delivery_notes con el esquema nuevo -------------------------------
    op.create_table(
        "delivery_notes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("source_file_id", sa.UUID(), nullable=False),
        sa.Column("cliente", sa.Text(), nullable=True),
        sa.Column("numero_cliente", sa.String(length=100), nullable=True),
        sa.Column("fecha_hora", sa.DateTime(timezone=True), nullable=True),
        sa.Column("numero_remito", sa.String(length=150), nullable=True),
        sa.Column("comentarios", sa.Text(), nullable=True),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("detection_index", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="processed"),
        sa.Column("extraction_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "manually_reviewed", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("reviewed_by", sa.UUID(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["source_file_id"], ["source_files.id"]),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_delivery_notes_numero_remito", "delivery_notes", ["numero_remito"])
    op.create_index("idx_delivery_notes_numero_cliente", "delivery_notes", ["numero_cliente"])
    op.create_index("idx_delivery_notes_cliente", "delivery_notes", ["cliente"])
    op.create_index("idx_delivery_notes_fecha_hora", "delivery_notes", ["fecha_hora"])
    op.create_index("idx_delivery_notes_status", "delivery_notes", ["status"])


def downgrade() -> None:
    """Downgrade schema: vuelve al esquema Drive/n8n de e84bf56e8e82."""
    op.drop_index("idx_delivery_notes_status", table_name="delivery_notes")
    op.drop_index("idx_delivery_notes_fecha_hora", table_name="delivery_notes")
    op.drop_index("idx_delivery_notes_cliente", table_name="delivery_notes")
    op.drop_index("idx_delivery_notes_numero_cliente", table_name="delivery_notes")
    op.drop_index("idx_delivery_notes_numero_remito", table_name="delivery_notes")
    op.drop_table("delivery_notes")

    op.drop_constraint("fk_source_files_uploaded_by_users", "source_files", type_="foreignkey")
    op.drop_constraint("uq_source_files_sha256", "source_files", type_="unique")
    for column in (
        "processing_started_at",
        "uploaded_by",
        "minio_preview_key",
        "minio_optimized_key",
        "minio_original_key",
        "sha256",
        "optimized_size_bytes",
        "original_size_bytes",
        "mime_type",
    ):
        op.drop_column("source_files", column)

    op.alter_column(
        "source_files",
        "status",
        existing_type=sa.String(length=30),
        existing_nullable=False,
        server_default=None,
    )
    op.alter_column(
        "source_files",
        "processed_at",
        type_=sa.DateTime(),
        existing_nullable=True,
    )
    op.alter_column(
        "source_files",
        "created_at",
        type_=sa.DateTime(),
        existing_nullable=False,
        existing_server_default=sa.text("now()"),
    )

    op.add_column("source_files", sa.Column("original_drive_link", sa.Text(), nullable=True))
    op.add_column(
        "source_files",
        sa.Column("drive_file_id", sa.String(length=255), nullable=False, server_default=""),
    )
    op.alter_column("source_files", "drive_file_id", server_default=None)
    op.create_unique_constraint("source_files_drive_file_id_key", "source_files", ["drive_file_id"])

    op.create_table(
        "clients",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("client_number", sa.String(length=50), nullable=False),
        sa.Column("client_name", sa.Text(), nullable=False),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("locality", sa.Text(), nullable=True),
        sa.Column("drive_folder_id", sa.Text(), nullable=True),
        sa.Column("drive_folder_link", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_number"),
    )
    op.create_table(
        "delivery_notes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("source_file_id", sa.UUID(), nullable=False),
        sa.Column("client_id", sa.UUID(), nullable=True),
        sa.Column("document_number", sa.String(length=100), nullable=True),
        sa.Column("document_date", sa.Date(), nullable=True),
        sa.Column("document_time", sa.Time(), nullable=True),
        sa.Column("client_number", sa.String(length=50), nullable=True),
        sa.Column("client_name", sa.Text(), nullable=True),
        sa.Column("drive_file_id", sa.Text(), nullable=True),
        sa.Column("drive_file_link", sa.Text(), nullable=True),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("confidence", sa.Numeric(precision=5, scale=4), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("extraction_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["source_file_id"], ["source_files.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_delivery_notes_client_document",
        "delivery_notes",
        ["client_number", "document_number"],
        unique=False,
    )

    op.drop_table("users")
