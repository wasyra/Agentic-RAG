from __future__ import annotations

import json
import logging
import os
import secrets
from typing import Any

from app.config import settings
from app.routers.deps import server_api_key_for_provider
from app.services.app_settings import read_app_settings
from app.services.models_const import resolve_ai_provider

logger = logging.getLogger(__name__)

QUEUE_KEY = "rag:index:queue"
INDEX_CRED_KEY_PREFIX = "rag:index:cred:"


def redis_url() -> str:
    return (os.environ.get("REDIS_URL") or "").strip()


def _enqueue_provider(creds: dict[str, Any] | None, app_settings: dict[str, Any]) -> str:
    if creds and str(creds.get("provider") or "").strip():
        p = str(creds["provider"]).strip().lower()
        return "google" if p == "google" else "openai"
    return resolve_ai_provider(app_settings)


async def enqueue_index_job(
    document_id: str,
    creds: dict[str, Any] | None,
) -> bool:
    """
    Encola indexación en Redis. El payload de la lista **no incluye** API keys en claro:
    - Si hay clave de servidor para el proveedor efectivo, solo va `document_id`.
    - Si no, guarda credenciales bajo una clave opaca con TTL y la cola transporta `key_ref`.
    """
    url = redis_url()
    if not url:
        return False

    app_settings = await read_app_settings()
    provider = _enqueue_provider(creds, app_settings)
    has_server = server_api_key_for_provider(provider) is not None
    user_key = creds and str(creds.get("apiKey") or "").strip()

    if has_server:
        payload_obj: dict[str, Any] = {"document_id": document_id}
        cred_key_full: str | None = None
        cred_json: str | None = None
    elif user_key:
        ref = secrets.token_urlsafe(24)
        cred_key_full = INDEX_CRED_KEY_PREFIX + ref
        cred_json = json.dumps(
            {
                "provider": str(creds["provider"] if creds else provider),
                "apiKey": str(creds["apiKey"]).strip(),
            },
            ensure_ascii=False,
        )
        payload_obj = {"document_id": document_id, "key_ref": ref}
    else:
        logger.warning(
            "[index_queue] no se encola document_id=%s: sin clave de servidor ni credencial de cliente",
            document_id,
        )
        return False

    payload = json.dumps(payload_obj, ensure_ascii=False)
    try:
        import redis.asyncio as redis_async

        client = redis_async.from_url(url, decode_responses=True)
        try:
            if cred_key_full and cred_json:
                ttl = max(60, int(settings.index_queue_cred_ttl_seconds))
                await client.setex(cred_key_full, ttl, cred_json)
            await client.rpush(QUEUE_KEY, payload)
        finally:
            await client.aclose()
        return True
    except Exception:
        logger.exception("[index_queue] no se pudo encolar document_id=%s", document_id)
        return False
