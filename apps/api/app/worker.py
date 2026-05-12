"""
Worker de indexación: consume la cola Redis `rag:index:queue` (mismo contrato que index_queue.py).

Ejecutar:  python -m app.worker
Requiere: REDIS_URL, DATABASE_URL, STORAGE_ROOT (y mismos valores que el API).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal

from app.db import close_pool, init_pool
from app.services.index_document import index_document
from app.services.index_queue import QUEUE_KEY, redis_url

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
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
            creds = {
                "provider": str(job.get("provider") or "openai"),
                "apiKey": str(job["api_key"]),
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
    main()
