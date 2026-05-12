from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header

from app.services.models_const import is_allowed_ai_provider


def parse_ai_creds(
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
    x_ai_provider: Annotated[str | None, Header(alias="X-AI-Provider")] = None,
) -> dict[str, str] | None:
    key = (x_api_key or "").strip()
    if not key:
        return None
    raw = (x_ai_provider or "").strip().lower()
    provider = "google" if raw == "google" else "openai"
    if not is_allowed_ai_provider(provider):
        return None
    return {"provider": provider, "apiKey": key}


AiCredsDep = Annotated[dict[str, str] | None, Depends(parse_ai_creds)]
