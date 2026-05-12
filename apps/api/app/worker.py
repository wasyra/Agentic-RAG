from __future__ import annotations

import asyncio
import json
import logging
import signal

from app.db import close_pool, init_pool
from app.services.index_document import index_document
from app.services.index_queue import INDEX_CRED_KEY_PREFIX, QUEUE_KEY, redis_url

logger = logging.getLogger(__name__)

_stop = asyncio.Event()


def _handle_stop(*_args: object) -> None:
    _stop.set()


async def _run() -> None:
    url = redis_url()
    if not url:
        logger.error("REDIS_URL no está definido; el worker no puede arrancar.")
        raise SystemExit(1)

    await init_pool()
    import redis.asyncio as redis_async

    client = redis_async.from_url(url, decode_responses=True)
    logger.info("Worker de indexación escuchando cola %s", QUEUE_KEY)

    while not _stop.is_set():
        try:
            item = await client.blpop(QUEUE_KEY, timeout=5)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("BLPOP falló; reintento en 5s")
            await asyncio.sleep(5)
            continue
        if item is None:
            continue
        _key, raw = item
        try:
            job = json.loads(raw)
            doc_id = str(job["document_id"])
            creds: dict[str, str] | None = None
            key_ref = job.get("key_ref")
            if key_ref:
                ref = str(key_ref).strip()
                if not ref:
                    raise ValueError("key_ref vacío")
                cred_raw = await client.getdel(INDEX_CRED_KEY_PREFIX + ref)
                if not cred_raw:
                    raise ValueError(
                        "Credencial temporal de cola ausente o expirada (TTL). "
                        "Vuelve a indexar desde la API."
                    )
                parsed = json.loads(cred_raw)
                creds = {
                    "provider": str(parsed.get("provider") or "openai"),
                    "apiKey": str(parsed["apiKey"]),
                }
            logger.info("Indexando documento %s", doc_id)
            await index_document(doc_id, creds)
        except Exception:
            logger.exception("Fallo al procesar job de cola")

    await client.aclose()
    await close_pool()
    logger.info("Worker detenido.")


def main() -> None:
    signal.signal(signal.SIGINT, _handle_stop)
    signal.signal(signal.SIGTERM, _handle_stop)
    asyncio.run(_run())


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
