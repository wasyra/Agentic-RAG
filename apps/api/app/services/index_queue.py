from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

QUEUE_KEY = "rag:index:queue"


def redis_url() -> str:
    return (os.environ.get("REDIS_URL") or "").strip()


async def enqueue_index_job(document_id: str, creds: dict[str, Any]) -> bool:
    """
    Encola indexación en Redis. El worker debe tener REDIS_URL y compartir DB/storage con la API.
    Retorna False si Redis no está configurado o falla el push (el caller puede usar BackgroundTasks).
    """
    url = redis_url()
    if not url:
        return False
    api_key = str(creds.get("apiKey") or "").strip()
    provider = str(creds.get("provider") or "openai").strip()
    if not api_key:
        return False
    payload = json.dumps(
        {"document_id": document_id, "provider": provider, "api_key": api_key},
        ensure_ascii=False,
    )
    try:
        import redis.asyncio as redis_async

        client = redis_async.from_url(url, decode_responses=True)
        try:
            await client.rpush(QUEUE_KEY, payload)
        finally:
            await client.aclose()
        return True
    except Exception:
        logger.exception("[index_queue] no se pudo encolar document_id=%s", document_id)
        return False
