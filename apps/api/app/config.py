from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://rag:rag@localhost:5432/rag_kb"
    storage_root: str = "./storage"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    max_upload_bytes: int = 20 * 1024 * 1024
    """Tamaño máximo por archivo subido (bytes)."""
    upload_allowed_mimes: str = (
        "application/pdf,text/plain,text/markdown,"
        "text/x-markdown,application/octet-stream"
    )
    """Lista separada por comas; octet-stream se acepta solo si la extensión es .pdf/.txt/.md."""
    max_documents_per_knowledge_base: int = 200
    index_queue_cred_ttl_seconds: int = 900
    """TTL de credenciales efímeras en Redis cuando no hay clave de servidor (solo referencia opaca)."""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def upload_allowed_mimes_list(self) -> set[str]:
        return {
            x.strip().lower()
            for x in self.upload_allowed_mimes.split(",")
            if x.strip()
        }


settings = Settings()
