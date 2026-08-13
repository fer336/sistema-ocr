from functools import cached_property
from pathlib import Path

from dotenv import load_dotenv
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Estándar de infraestructura Qeva (INFRASTRUCTURE.md §9/§17): un único
# Docker Secret por proyecto, con forma de archivo .env, montado en
# /run/secrets/<project>_env. En producción (Portainer) ese archivo existe;
# en desarrollo local no, y cae a .env en la raíz del backend. load_dotenv
# no pisa variables que ya estén en el entorno del proceso (docker-compose
# `environment:` en dev local vía compose, por ejemplo), así que este orden
# es seguro en cualquier combinación.
_PROJECT_SECRET = Path("/run/secrets/remitos_env")
if _PROJECT_SECRET.exists():
    load_dotenv(_PROJECT_SECRET)
else:
    load_dotenv(".env")


class Settings(BaseSettings):
    """Configuración completa del backend (PRD §23 + autenticación).

    Todo lo que el PRD marca como "debe poder cambiar sin reescribir el
    sistema" (§29) vive acá: modelo OCR, bucket, tamaño objetivo de imagen,
    concurrencia, reintentos y expiración de URLs prefirmadas.

    El origen de estos valores lo resuelve `load_dotenv` arriba (secret
    único de Qeva en producción, `.env` en desarrollo) -- acá solo se
    validan/tipan, `pydantic-settings` los toma directo de las variables de
    entorno del proceso una vez cargadas.
    """

    model_config = SettingsConfigDict(extra="ignore")

    app_env: str = "development"
    # INF-502: versión efectivamente desplegada, expuesta en GET /version.
    # La inyecta docker-compose.yml (no remitos_env: no es config de la app,
    # es metadata de deployment) -- release.yml la reescribe junto al tag de
    # imagen en cada release.
    app_version: str = "dev"
    database_url: str

    # --- MinIO / S3 -------------------------------------------------------
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_bucket: str = "remitos"
    minio_secure: bool = False
    minio_presigned_expires_seconds: int = 900
    # Vacío = el cliente MinIO decide (MinIO propio no lo necesita). Algunos
    # backends S3-compatibles sí lo exigen para firmar bien la request.
    minio_region: str = ""

    # --- Gemini / OCR -----------------------------------------------------
    gemini_api_key: str = ""
    ocr_model: str = "models/gemini-3.5-flash-lite"
    ocr_timeout_seconds: int = 120
    ocr_max_retries: int = 3

    # --- Imagen -----------------------------------------------------------
    target_image_size_kb: int = 300
    image_max_width: int = 2200
    image_max_height: int = 2200
    image_start_quality: int = 88
    image_min_quality: int = 55

    # --- Uploads y procesamiento -----------------------------------------
    max_upload_mb: int = 25
    processing_batch_size: int = 3
    max_concurrent_ocr: int = 3

    # --- Autenticación ----------------------------------------------------
    google_oauth_client_id: str = ""
    jwt_secret_key: str = "changeme"
    jwt_expires_minutes: int = 60 * 24 * 7
    # Lista separada por comas. Vacío = cualquier cuenta Google verificada.
    allowed_google_emails: str = ""
    session_cookie_name: str = "remitos_session"
    session_cookie_secure: bool = False
    session_cookie_samesite: str = "lax"

    # --- CORS -------------------------------------------------------------
    # Lista separada por comas de orígenes permitidos para el frontend.
    cors_origins: str = "http://localhost:5173,http://localhost:8080"

    # --- Links cortos (compartir por WhatsApp) --------------------------------
    # URL pública desde la que se sirve ESTE backend -- sin ella los links
    # cortos (`{public_base_url}/s/{code}`) apuntarían a nada. En local vale
    # http://localhost:8000, pero para que un cliente externo pueda abrir el
    # link de verdad hace falta el dominio público real.
    public_base_url: str = "http://localhost:8000"

    @field_validator("jwt_secret_key")
    @classmethod
    def _reject_empty_jwt_secret(cls, value: str) -> str:
        """Un secreto vacío firma sesiones que cualquiera puede falsificar.

        `docker-compose.yml` expande `${JWT_SECRET_KEY}` a "" cuando la
        variable no está en el `.env`, así que sin este chequeo el stack
        arrancaría silenciosamente con sesiones falsificables.
        """
        if not value.strip():
            raise ValueError("JWT_SECRET_KEY no puede estar vacío")
        return value

    @cached_property
    def allowed_google_emails_list(self) -> list[str]:
        return [item.strip().lower() for item in self.allowed_google_emails.split(",") if item.strip()]

    @cached_property
    def cors_origins_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def target_image_size_bytes(self) -> int:
        return self.target_image_size_kb * 1024


settings = Settings()
