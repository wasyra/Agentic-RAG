from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from openai import APIStatusError, RateLimitError
from pydantic import BaseModel, Field

from app.db import get_pool
from app.routers.deps import parse_ai_creds

from app.services.app_settings import read_app_settings
from app.services.chat_generate import generate_chat_reply
from app.services.embeddings import embed_texts_unified
from app.services.google_backoff import is_google_daily_quota_exhausted
from app.services.models_const import (
    GOOGLE_MODEL_FALLBACK_ORDER,
    resolve_chat_model_for_provider,
)
from app.services.retrieve import retrieve_similar_chunks

logger = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)

MAX_COSINE_DISTANCE = 0.62
RETRIEVAL_TOP_K = 8


class ChatMessageIn(BaseModel):
    role: str
    content: str


class ChatBody(BaseModel):
    messages: list[ChatMessageIn] = Field(default_factory=list)
    knowledgeBaseId: str | None = None


def _excerpt(s: str, max_len: int = 280) -> str:
    t = s.strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 1] + "…"


def _google_api_rate_limit_exception(exc: BaseException) -> bool:
    try:
        from google.api_core import exceptions as gexc

        return isinstance(exc, (gexc.ResourceExhausted, gexc.TooManyRequests))
    except ImportError:
        return False


def _is_explicit_http_rate_limit(exc: BaseException) -> bool:
    chain: list[BaseException] = [exc]
    c = getattr(exc, "__cause__", None)
    if isinstance(c, BaseException):
        chain.append(c)
    c2 = getattr(exc, "__context__", None)
    if isinstance(c2, BaseException) and c2 is not c:
        chain.append(c2)
    for e in chain:
        if isinstance(e, RateLimitError):
            return True
        if isinstance(e, APIStatusError) and e.status_code == 429:
            return True
        if _google_api_rate_limit_exception(e):
            return True
    return False


def _is_rate_limit_or_quota_message(msg: str) -> bool:
    """
    Heurística solo si el tipo de excepción no fue reconocido. Evita:
    - `429` suelto (UUIDs hex, números).
    - "too many requests" suelto (aparece en textos de documentación de errores).
    - "quota" + "exceeded" en frases tipo "quota has not been exceeded".
    """
    m = msg.lower()
    if "resource_exhausted" in m:
        return True
    if re.search(
        r"(quota\s+exceeded|exceeded\s+(your|the|their)\s+quota|exceeded\s+quota)",
        m,
        re.I,
    ):
        return True
    if "rate_limit_exceeded" in m or "ratelimiterror" in m:
        return True
    if re.search(r"error\s*code\s*:\s*429\b", m, re.I):
        return True
    if re.search(r"\bstatus\s*429\b", m, re.I):
        return True
    return False


def _is_daily_quota_exhausted(raw: str) -> bool:
    """
    Detecta el caso específico de cuota diaria agotada en el tier gratuito.
    Google incluye "limit: 0" o "free_tier" en el mensaje cuando la cuota del día
    llegó a 0 (distinto de un simple rate-limit por RPM).
    """
    m = raw.lower()
    return ("limit: 0" in m or "free_tier" in m) and "quota" in m


def _rate_limit_user_message(provider: str, raw: str = "") -> str:
    if provider == "google":
        if _is_daily_quota_exhausted(raw):
            return (
                "⚠️ Cuota diaria del tier gratuito de Google agotada. "
                "No quedan peticiones disponibles para hoy con esta clave. "
                "Opciones: (1) espera hasta mañana (la cuota se renueva cada 24 h), "
                "(2) activa facturación en console.cloud.google.com para eliminar el límite, "
                "o (3) cambia a OpenAI en Ajustes IA."
            )
        return (
            "Google devolvió límite de peticiones (RPM). "
            "Espera 30–60 segundos y vuelve a intentar. "
            "Si persiste, la cuota diaria puede estar cerca del límite; "
            "revisa uso en aistudio.google.com o cambia a OpenAI en Ajustes."
        )
    return (
        "OpenAI devolvió límite de peticiones (429). Espera un momento y reintenta; "
        "si persiste, revisa uso y facturación en platform.openai.com."
    )


def _is_not_found_model_or_endpoint(exc: BaseException) -> bool:
    """404 modelo / ruta: no debe clasificarse como 429 por heurísticas en el texto."""
    if isinstance(exc, APIStatusError) and exc.status_code == 404:
        return True
    try:
        from google.api_core import exceptions as gexc

        chain = [exc, getattr(exc, "__cause__", None), getattr(exc, "__context__", None)]
        return any(isinstance(e, gexc.NotFound) for e in chain if isinstance(e, BaseException))
    except ImportError:
        return False


def _map_provider_exception(provider: str, exc: BaseException) -> tuple[str, int]:
    if _is_not_found_model_or_endpoint(exc):
        raw = str(exc) if isinstance(exc, Exception) else str(exc)
        msg = re.sub(r"^\[GoogleGenerativeAI Error\]:\s*", "", raw, flags=re.I).strip()
        logger.warning("Modelo o recurso no encontrado (%s): %s", type(exc).__name__, exc)
        return (msg[:1200] + "…" if len(msg) > 1200 else msg, 502)
    raw_str = str(exc)
    if _is_explicit_http_rate_limit(exc) or _is_rate_limit_or_quota_message(raw_str):
        return _rate_limit_user_message(provider, raw_str), 429
    raw = str(exc) if isinstance(exc, Exception) else str(exc)
    msg = re.sub(r"^\[GoogleGenerativeAI Error\]:\s*", "", raw, flags=re.I).strip()
    logger.warning("Fallo API de modelo/embed (%s): %s", type(exc).__name__, exc)
    return (msg[:1200] + "…" if len(msg) > 1200 else msg, 502)


def _google_fallback_chain(primary_model: str) -> list[str]:
    """
    Devuelve la cadena de modelos a intentar en orden, empezando por el configurado.
    Si el modelo primario no está en el orden canónico se añade al inicio.
    """
    try:
        idx = GOOGLE_MODEL_FALLBACK_ORDER.index(primary_model)
        return GOOGLE_MODEL_FALLBACK_ORDER[idx:]
    except ValueError:
        return [primary_model, *GOOGLE_MODEL_FALLBACK_ORDER]


@router.post("/chat")
async def chat(
    body: ChatBody,
    creds: dict[str, str] | None = Depends(parse_ai_creds),
):
    last_user = next(
        (m for m in reversed(body.messages or []) if m.role == "user"),
        None,
    )
    if not last_user or not last_user.content.strip():
        raise HTTPException(status_code=400, detail="Falta un mensaje del usuario")

    kb = (body.knowledgeBaseId or "").strip()
    if not kb or not UUID_RE.match(kb):
        raise HTTPException(
            status_code=400, detail="knowledgeBaseId UUID inválido o ausente"
        )

    if not creds:
        return JSONResponse(
            {
                "error": "Falta la API key. En **Ajustes** elige OpenAI o Google, pega una sola clave y guarda.",
            },
            status_code=401,
        )

    settings = await read_app_settings()
    provider = creds["provider"]
    chat_model = resolve_chat_model_for_provider(provider, settings)

    pool = get_pool()
    async with pool.acquire() as conn:
        chunk_n = await conn.fetchval(
            """
            SELECT count(*)::int FROM chunks
            WHERE knowledge_base_id = $1::uuid AND embedding IS NOT NULL
            """,
            kb,
        )

    if not chunk_n:
        reply = (
            "No hay fragmentos indexados en esta base de conocimiento. Sube un PDF o TXT "
            "y espera a que el estado pase a **indexed**."
        )
        return {
            "reply": reply,
            "citations": [],
            "knowledgeBaseId": kb,
            "abstained": True,
        }

    try:
        [q_vec] = await embed_texts_unified(
            provider,
            creds["apiKey"],
            [last_user.content.strip()],
            task_type="retrieval_query",   # consulta, no documento
        )
    except Exception as e:
        message, status = _map_provider_exception(provider, e)
        return JSONResponse(
            {"error": f"Error al generar embedding de la pregunta: {message}"},
            status_code=status,
        )

    async with pool.acquire() as conn:
        retrieved = await retrieve_similar_chunks(conn, kb, q_vec, RETRIEVAL_TOP_K)

    logger.info(
        "Chat [%s] provider=%s model=%s chunks_retrieved=%d",
        kb[:8],
        provider,
        chat_model,
        len(retrieved),
    )

    if not retrieved or retrieved[0].distance > MAX_COSINE_DISTANCE:
        reply = (
            "No encontré en tus documentos indexados información suficientemente relacionada con esa pregunta, "
            "así que no invento una respuesta. Prueba reformular o sube más material al respecto."
        )
        return {
            "reply": reply,
            "citations": [],
            "knowledgeBaseId": kb,
            "abstained": True,
        }

    used = [r for r in retrieved if r.distance <= MAX_COSINE_DISTANCE]
    context_blocks = "\n\n".join(
        f"### Fragmento [{i + 1}]\n**Documento:** {r.title}"
        + (f" · página {r.page}" if r.page is not None else "")
        + f"\n{r.content}"
        for i, r in enumerate(used)
    )

    system = f"""Eres un asistente que responde **solo en español** usando únicamente el CONTEXTO siguiente (fragmentos recuperados de documentos del usuario).
Reglas:
- Si la respuesta no está respaldada por el contexto, dilo claramente.
- No inventes datos, fechas, cifras ni referencias externas al contexto.
- Cuando uses un fragmento, indica su número entre corchetes, p. ej. [1], [2], según el orden del contexto.

<CONTEXTO>
{context_blocks}
</CONTEXTO>"""

    hist_raw = [m for m in (body.messages or []) if m.role in ("user", "assistant")][-10:]
    history: list[dict[str, str]] = [
        {"role": m.role, "content": m.content[:12000]} for m in hist_raw
    ]

    # Intenta generar respuesta; si Google agota cuota diaria prueba el siguiente modelo.
    reply: str | None = None
    generate_exc: Exception | None = None
    models_to_try = (
        _google_fallback_chain(chat_model)
        if provider == "google"
        else [chat_model]
    )
    for attempt_model in models_to_try:
        try:
            if attempt_model != chat_model:
                logger.warning(
                    "Cuota diaria agotada para %s → intentando fallback con %s",
                    chat_model,
                    attempt_model,
                )
            reply = await generate_chat_reply(
                provider=provider,
                model=attempt_model,
                system=system,
                history=history,
                api_key=creds["apiKey"],
            )
            if attempt_model != chat_model:
                logger.info("Fallback exitoso con %s", attempt_model)
            break
        except Exception as e:
            generate_exc = e
            if provider == "google" and is_google_daily_quota_exhausted(e):
                # Cuota diaria de este modelo agotada → probar el siguiente
                continue
            # Cualquier otro error → salir del loop inmediatamente
            break

    if reply is None:
        exc = generate_exc or RuntimeError("No se pudo generar respuesta")
        message, status = _map_provider_exception(provider, exc)
        if provider == "google" and is_google_daily_quota_exhausted(exc) and len(models_to_try) > 1:
            message = (
                "⚠️ Cuota diaria agotada en todos los modelos de Google disponibles. "
                "Opciones: (1) espera hasta mañana (renueva cada 24 h), "
                "(2) activa facturación en console.cloud.google.com, "
                "o (3) cambia a OpenAI en Ajustes IA."
            )
        return JSONResponse(
            {"error": f"Error del modelo: {message}"},
            status_code=status,
        )

    citations: list[dict[str, Any]] = [
        {
            "chunkId": r.chunk_id,
            "documentId": r.document_id,
            "title": r.title,
            "page": r.page,
            "excerpt": _excerpt(r.content),
        }
        for r in used
    ]

    return {
        "reply": reply,
        "citations": citations,
        "knowledgeBaseId": kb,
        "abstained": False,
    }
