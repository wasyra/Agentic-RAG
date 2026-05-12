from __future__ import annotations

import os
from typing import Annotated, Any

from fastapi import Depends, Header

from app.services.app_settings import read_app_settings
from app.services.models_const import is_allowed_ai_provider, resolve_ai_provider


def server_api_key_for_provider(provider: str) -> str | None:
    if provider == "google":
        v = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    else:
        v = os.environ.get("OPENAI_API_KEY")
    return v.strip() if v and str(v).strip() else None


def parse_ai_creds(
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
    x_ai_provider: Annotated[str | None, Header(alias="X-AI-Provider")] = None,
) -> dict[str, str] | None:
    raw = (x_ai_provider or "").strip().lower()
    provider = "google" if raw == "google" else "openai"
    if not is_allowed_ai_provider(provider):
        provider = "openai"

    key = (x_api_key or "").strip()
    if key:
        return {"provider": provider, "apiKey": key}

    sk = server_api_key_for_provider(provider)
    if sk:
        return {"provider": provider, "apiKey": sk}
    return None


async def resolve_embedding_creds_async(creds: dict[str, Any] | None) -> dict[str, str]:
    """
    Credenciales para embeddings en indexación: primero credenciales explícitas,
    luego OPENAI_API_KEY / GOOGLE_API_KEY del servidor según ajustes.
    """
    if creds and str(creds.get("apiKey") or "").strip():
        raw_p = str(creds.get("provider") or "openai").strip().lower()
        provider = "google" if raw_p == "google" else "openai"
        if not is_allowed_ai_provider(provider):
            provider = "openai"
        return {"provider": provider, "apiKey": str(creds["apiKey"]).strip()}

    settings = await read_app_settings()
    provider = resolve_ai_provider(settings)
    sk = server_api_key_for_provider(provider)
    if sk:
        return {"provider": provider, "apiKey": sk}

    raise ValueError(
        "Falta la API key para indexar. Configúrala en Ajustes (navegador), define "
        "OPENAI_API_KEY o GOOGLE_API_KEY en el servidor del API, o reintenta mientras "
        "Redis tenga aún la credencial temporal de la cola."
    )


AiCredsDep = Annotated[dict[str, str] | None, Depends(parse_ai_creds)]
