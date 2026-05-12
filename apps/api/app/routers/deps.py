from __future__ import annotations

import os
from typing import Annotated

from fastapi import Depends, Header

from app.services.models_const import is_allowed_ai_provider


def _server_api_key_for_provider(provider: str) -> str | None:
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

    sk = _server_api_key_for_provider(provider)
    if sk:
        return {"provider": provider, "apiKey": sk}
    return None


AiCredsDep = Annotated[dict[str, str] | None, Depends(parse_ai_creds)]
