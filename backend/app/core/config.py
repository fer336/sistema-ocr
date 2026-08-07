from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str

    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_model: str = "gpt-4o"

    internal_api_token: str = "changeme"

    processing_batch_size: int = 3
    max_concurrent_files: int = 3
    max_retries: int = 3
    processing_timeout_seconds: int = 120


settings = Settings()
