from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.config import settings
from app.services.models_const import (
    default_chat_model_for_provider,
    is_allowed_chat_model_for_provider,
    is_allowed_ai_provider,
    normalize_google_chat_model_id,
    resolve_ai_provider,
    resolve_chat_model_for_provider,
)


def _settings_path() -> Path:
    return Path(settings.storage_root).resolve() / "app-settings.json"


def _sanitize_parsed(raw: dict[str, Any]) -> dict[str, Any]:
    o = {**raw}
    o.pop("openaiApiKey", None)
    o.pop("embeddingModel", None)
    if o.get("chatProvider") == "anthropic":
        o["chatProvider"] = "openai"
    if o.get("chatModel") == "gemini-2.0-flash-lite":
        o["chatModel"] = "gemini-2.0-flash"
    prov = resolve_ai_provider(o)
    if prov == "google" and o.get("chatModel"):
        mid = normalize_google_chat_model_id(str(o["chatModel"]))
        if is_allowed_chat_model_for_provider("google", mid):
            o["chatModel"] = mid
        else:
            o["chatModel"] = default_chat_model_for_provider("google")
    return o


async def read_app_settings() -> dict[str, Any]:
    path = _settings_path()
    try:
        text = path.read_text(encoding="utf-8")
        raw = json.loads(text)
        sanitized = _sanitize_parsed(raw)
        # Persistir si la migración cambió algo (ej. gemini-1.5-flash → 2.5-flash)
        if sanitized != {k: v for k, v in raw.items() if k not in ("openaiApiKey", "embeddingModel")}:
            try:
                await write_app_settings(sanitized)
            except OSError:
                pass
        return sanitized
    except (OSError, json.JSONDecodeError):
        return {}


async def write_app_settings(next_data: dict[str, Any]) -> None:
    path = _settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(next_data, indent=2, ensure_ascii=False), encoding="utf-8")


async def merge_app_settings(patch: dict[str, Any]) -> dict[str, Any]:
    cur = await read_app_settings()
    merged = {**cur}

    if "chatProvider" in patch and patch["chatProvider"] is not None:
        prov = str(patch["chatProvider"]).strip().lower()
        if not is_allowed_ai_provider(prov):
            raise ValueError("Proveedor no permitido")
        merged["chatProvider"] = prov
        m = str(merged.get("chatModel") or "").strip()
        if not m or not is_allowed_chat_model_for_provider(prov, m):
            merged["chatModel"] = default_chat_model_for_provider(prov)

    if "chatModel" in patch and patch["chatModel"] is not None:
        prov = resolve_ai_provider(merged)
        next_model = str(patch["chatModel"]).strip()
        if next_model == "gemini-2.0-flash-lite":
            next_model = "gemini-2.0-flash"
        if prov == "google":
            next_model = normalize_google_chat_model_id(next_model)
        if not is_allowed_chat_model_for_provider(prov, next_model):
            raise ValueError("Modelo no permitido para el proveedor actual")
        merged["chatModel"] = next_model

    await write_app_settings(merged)
    return merged
