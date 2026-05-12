"""
Serialización, reintentos y backoff exponencial para llamadas a la API de Google.

Problema raíz en el tier gratuito:
  - generate_content (gemini-2.x-flash): 5–15 RPM según modelo
  - embed_content (gemini-embedding-001): 100 QPM (más holgado)

Solución:
  _GOOGLE_SEMAPHORE limita a 1 llamada Google concurrente en este proceso.
  Se usan intervalos mínimos DISTINTOS según el tipo de llamada:
    - "embed"     → 2 s  (cuota de embeddings es alta)
    - "generate"  → 13 s (5 RPM ≈ 1 petición cada 12 s + 1 s de margen)
    - "default"   → 2 s  (genérico)
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Callable
from typing import Literal, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

CallType = Literal["embed", "generate", "default"]

# ── Semáforo global ────────────────────────────────────────────────────────────
# Máx 1 llamada Google activa a la vez. Evita ráfagas que agotan el RPM.
_GOOGLE_SEMAPHORE = asyncio.Semaphore(1)

# Pausa mínima (segundos) entre llamadas consecutivas por tipo.
_MIN_INTERVAL: dict[CallType, float] = {
    "embed": 2.0,      # embeddings tienen cuota alta (100 QPM)
    "generate": 13.0,  # generate_content: 5 RPM free tier → 60/5 = 12 s, +1 margen
    "default": 2.0,
}

# Última llamada por tipo
_last_call: dict[CallType, float] = {
    "embed": 0.0,
    "generate": 0.0,
    "default": 0.0,
}


def is_google_retryable_quota(exc: BaseException) -> bool:
    try:
        from google.api_core import exceptions as gexc
    except ImportError:
        return False
    e: BaseException | None = exc
    seen: set[int] = set()
    for _ in range(8):
        if e is None or id(e) in seen:
            break
        seen.add(id(e))
        if isinstance(e, (gexc.ResourceExhausted, gexc.TooManyRequests)):
            return True
        e = getattr(e, "__cause__", None) or getattr(e, "__context__", None)
    msg = str(exc).lower()
    if "resource_exhausted" in msg or "rate_limit_exceeded" in msg:
        return True
    if re.search(r"error\s*code\s*:\s*429\b", msg):
        return True
    return False


def is_google_daily_quota_exhausted(exc: BaseException) -> bool:
    """Detecta específicamente cuota DIARIA agotada (limit: 0 en el mensaje)."""
    msg = str(exc).lower()
    return ("limit: 0" in msg or "free_tier" in msg) and "quota" in msg


async def run_google_sync_with_backoff(
    fn: Callable[[], T],
    *,
    call_type: CallType = "default",
    attempts: int = 4,
    base_delay_s: float = 2.0,
    max_delay_s: float = 20.0,
) -> T:
    """
    Ejecuta `fn` (síncrona) en un thread con:
      1. Semáforo global (solo 1 llamada Google a la vez).
      2. Intervalo mínimo por tipo de llamada para respetar RPM diferenciado.
      3. Reintentos con backoff exponencial ante cuota de RPM (no cuota diaria).
    """
    async with _GOOGLE_SEMAPHORE:
        min_interval = _MIN_INTERVAL[call_type]
        loop = asyncio.get_event_loop()
        now = loop.time()
        wait = min_interval - (now - _last_call[call_type])
        if wait > 0:
            await asyncio.sleep(wait)

        for attempt in range(attempts):
            try:
                _last_call[call_type] = asyncio.get_event_loop().time()
                result = await asyncio.to_thread(fn)
                return result
            except BaseException as e:
                # La cuota diaria (limit: 0) no se recupera reintentando → lanzar inmediatamente
                if is_google_daily_quota_exhausted(e):
                    logger.warning(
                        "Google API [%s]: cuota diaria agotada — %s",
                        call_type,
                        str(e)[:500],
                    )
                    raise

                if attempt >= attempts - 1 or not is_google_retryable_quota(e):
                    logger.warning(
                        "Google API error [%s] (%s): %s",
                        call_type,
                        type(e).__name__,
                        str(e)[:500],
                    )
                    raise

                delay = min(max_delay_s, base_delay_s * (2**attempt))
                logger.info(
                    "Google API [%s]: reintento %s/%s tras %s (espera %.1fs) — %s",
                    call_type,
                    attempt + 2,
                    attempts,
                    type(e).__name__,
                    delay,
                    str(e)[:200],
                )
                await asyncio.sleep(delay)

    raise RuntimeError("run_google_sync_with_backoff: unreachable")
