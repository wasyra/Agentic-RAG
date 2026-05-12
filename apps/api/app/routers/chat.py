from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from openai import APIStatusError, RateLimitError
from pydantic import BaseModel, Field

from app.db import get_pool
from app.routers.deps import parse_ai_creds

from app.services.app_settings import read_app_settings
from app.services.chat_generate import generate_chat_reply, stream_chat_reply_tokens
from app.services.embeddings import embed_texts_unified
from app.services.google_backoff import is_google_daily_quota_exhausted
from app.services.models_const import (
    GOOGLE_MODEL_FALLBACK_ORDER,
    resolve_chat_model_for_provider,
)
from app.services.retrieve import RetrievedChunk, retrieve_similar_chunks

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
    conversationId: str | None = None


def _excerpt(s: str, max_len: int = 280) -> str:
    t = s.strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 1] + "…"


def _sse(obj: dict[str, Any]) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


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
    try:
        idx = GOOGLE_MODEL_FALLBACK_ORDER.index(primary_model)
        return GOOGLE_MODEL_FALLBACK_ORDER[idx:]
    except ValueError:
        return [primary_model, *GOOGLE_MODEL_FALLBACK_ORDER]


async def _resolve_conversation_insert_user(
    conn: Any,
    *,
    kb: str,
    conversation_id: str | None,
    user_text: str,
) -> str:
    """Crea o valida conversación e inserta el mensaje del usuario. Devuelve conversation id."""
    conv_in = (conversation_id or "").strip()
    if conv_in and UUID_RE.match(conv_in):
        row = await conn.fetchrow(
            """
            SELECT id FROM conversations
            WHERE id = $1::uuid AND knowledge_base_id = $2::uuid
            LIMIT 1
            """,
            conv_in,
            kb,
        )
        if not row:
            raise HTTPException(
                status_code=400,
                detail="Conversación no encontrada en esta base de conocimiento.",
            )
        cid = str(row["id"])
        await conn.execute(
            """
            INSERT INTO messages (conversation_id, role, content)
            VALUES ($1::uuid, 'user', $2)
            """,
            cid,
            user_text,
        )
        await conn.execute(
            "UPDATE conversations SET updated_at = now() WHERE id = $1::uuid",
            cid,
        )
        return cid

    row = await conn.fetchrow(
        """
        INSERT INTO conversations (knowledge_base_id, title)
        VALUES ($1::uuid, left($2, 120))
        RETURNING id
        """,
        kb,
        user_text,
    )
    cid = str(row["id"])
    await conn.execute(
        """
        INSERT INTO messages (conversation_id, role, content)
        VALUES ($1::uuid, 'user', $2)
        """,
        cid,
        user_text,
    )
    return cid


async def _insert_assistant_message(
    conn: Any,
    conversation_id: str,
    content: str,
    citations: list[dict[str, Any]],
) -> None:
    raw = json.dumps(citations, ensure_ascii=False) if citations else None
    await conn.execute(
        """
        INSERT INTO messages (conversation_id, role, content, citations_json)
        VALUES ($1::uuid, 'assistant', $2, $3)
        """,
        conversation_id,
        content,
        raw,
    )
    await conn.execute(
        "UPDATE conversations SET updated_at = now() WHERE id = $1::uuid",
        conversation_id,
    )


def _rag_chat_log(
    *,
    event: str,
    kb: str,
    conversation_id: str | None,
    provider: str,
    model: str,
    abstained: bool,
    chunk_indexed: int,
    chunks_retrieved: int,
    top_distance: float | None,
    embed_ms: float,
    retrieve_ms: float,
    generate_ms: float,
    total_ms: float,
) -> None:
    logger.info(
        "rag_chat event=%s kb=%s conv=%s provider=%s model=%s abstained=%s "
        "chunks_indexed=%d chunks_retrieved=%d top_dist=%s embed_ms=%.1f retrieve_ms=%.1f "
        "generate_ms=%.1f total_ms=%.1f",
        event,
        kb[:8],
        (conversation_id or "-")[:8],
        provider,
        model,
        abstained,
        chunk_indexed,
        chunks_retrieved,
        f"{top_distance:.4f}" if top_distance is not None else "-",
        embed_ms,
        retrieve_ms,
        generate_ms,
        total_ms,
    )


def _citations_from_used(used: list[RetrievedChunk]) -> list[dict[str, Any]]:
    return [
        {
            "chunkId": r.chunk_id,
            "documentId": r.document_id,
            "title": r.title,
            "page": r.page,
            "excerpt": _excerpt(r.content),
        }
        for r in used
    ]


def _build_system_prompt(used: list[RetrievedChunk]) -> str:
    context_blocks = "\n\n".join(
        f"### Fragmento [{i + 1}]\n**Documento:** {r.title}"
        + (f" · página {r.page}" if r.page is not None else "")
        + f"\n{r.content}"
        for i, r in enumerate(used)
    )
    return f"""Eres un asistente que responde **solo en español** usando únicamente el CONTEXTO siguiente (fragmentos recuperados de documentos del usuario).
Reglas:
- Si la respuesta no está respaldada por el contexto, dilo claramente.
- No inventes datos, fechas, cifras ni referencias externas al contexto.
- Cuando uses un fragmento, indica su número entre corchetes, p. ej. [1], [2], según el orden del contexto.

<CONTEXTO>
{context_blocks}
</CONTEXTO>"""


@router.post("/chat")
async def chat(
    body: ChatBody,
    creds: dict[str, str] | None = Depends(parse_ai_creds),
):
    t_total0 = time.perf_counter()
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
                "error": (
                    "Falta la API key. Configúrala en **Ajustes** (cookie segura vía Next) o define "
                    "OPENAI_API_KEY / GOOGLE_API_KEY en el servidor del API."
                ),
            },
            status_code=401,
        )

    settings = await read_app_settings()
    provider = creds["provider"]
    chat_model = resolve_chat_model_for_provider(provider, settings)
    user_text = last_user.content.strip()

    pool = get_pool()
    t_embed0 = t_ret0 = t_gen0 = time.perf_counter()
    embed_ms = retrieve_ms = generate_ms = 0.0
    top_distance: float | None = None

    async with pool.acquire() as conn:
        chunk_n = await conn.fetchval(
            """
            SELECT count(*)::int FROM chunks
            WHERE knowledge_base_id = $1::uuid AND embedding IS NOT NULL
            """,
            kb,
        )

    conversation_id: str | None = None

    async with pool.acquire() as conn:
        async with conn.transaction():
            conversation_id = await _resolve_conversation_insert_user(
                conn, kb=kb, conversation_id=body.conversationId, user_text=user_text
            )

    if not chunk_n:
        reply = (
            "No hay fragmentos indexados en esta base de conocimiento. Sube un PDF o TXT "
            "y espera a que el estado pase a **indexed**."
        )
        async with pool.acquire() as conn:
            async with conn.transaction():
                await _insert_assistant_message(conn, conversation_id, reply, [])
        total_ms = (time.perf_counter() - t_total0) * 1000
        _rag_chat_log(
            event="complete",
            kb=kb,
            conversation_id=conversation_id,
            provider=provider,
            model=chat_model,
            abstained=True,
            chunk_indexed=0,
            chunks_retrieved=0,
            top_distance=None,
            embed_ms=0,
            retrieve_ms=0,
            generate_ms=0,
            total_ms=total_ms,
        )
        return {
            "reply": reply,
            "citations": [],
            "knowledgeBaseId": kb,
            "conversationId": conversation_id,
            "abstained": True,
        }

    try:
        t_embed0 = time.perf_counter()
        [q_vec] = await embed_texts_unified(
            provider,
            creds["apiKey"],
            [user_text],
            task_type="retrieval_query",
        )
        embed_ms = (time.perf_counter() - t_embed0) * 1000
    except Exception as e:
        message, status = _map_provider_exception(provider, e)
        total_ms = (time.perf_counter() - t_total0) * 1000
        _rag_chat_log(
            event="embed_error",
            kb=kb,
            conversation_id=conversation_id,
            provider=provider,
            model=chat_model,
            abstained=False,
            chunk_indexed=int(chunk_n or 0),
            chunks_retrieved=0,
            top_distance=None,
            embed_ms=embed_ms,
            retrieve_ms=0,
            generate_ms=0,
            total_ms=total_ms,
        )
        return JSONResponse(
            {"error": f"Error al generar embedding de la pregunta: {message}"},
            status_code=status,
        )

    t_ret0 = time.perf_counter()
    async with pool.acquire() as conn:
        retrieved = await retrieve_similar_chunks(conn, kb, q_vec, RETRIEVAL_TOP_K)
    retrieve_ms = (time.perf_counter() - t_ret0) * 1000

    if retrieved:
        top_distance = float(retrieved[0].distance)

    if not retrieved or retrieved[0].distance > MAX_COSINE_DISTANCE:
        reply = (
            "No encontré en tus documentos indexados información suficientemente relacionada con esa pregunta, "
            "así que no invento una respuesta. Prueba reformular o sube más material al respecto."
        )
        async with pool.acquire() as conn:
            async with conn.transaction():
                await _insert_assistant_message(conn, conversation_id, reply, [])
        total_ms = (time.perf_counter() - t_total0) * 1000
        _rag_chat_log(
            event="complete",
            kb=kb,
            conversation_id=conversation_id,
            provider=provider,
            model=chat_model,
            abstained=True,
            chunk_indexed=int(chunk_n or 0),
            chunks_retrieved=len(retrieved),
            top_distance=top_distance,
            embed_ms=embed_ms,
            retrieve_ms=retrieve_ms,
            generate_ms=0,
            total_ms=total_ms,
        )
        return {
            "reply": reply,
            "citations": [],
            "knowledgeBaseId": kb,
            "conversationId": conversation_id,
            "abstained": True,
        }

    used = [r for r in retrieved if r.distance <= MAX_COSINE_DISTANCE]
    system = _build_system_prompt(used)
    hist_raw = [m for m in (body.messages or []) if m.role in ("user", "assistant")][-10:]
    history: list[dict[str, str]] = [
        {"role": m.role, "content": m.content[:12000]} for m in hist_raw
    ]

    t_gen0 = time.perf_counter()
    reply: str | None = None
    generate_exc: Exception | None = None
    models_to_try = (
        _google_fallback_chain(chat_model) if provider == "google" else [chat_model]
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
                continue
            break
    generate_ms = (time.perf_counter() - t_gen0) * 1000

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
        total_ms = (time.perf_counter() - t_total0) * 1000
        _rag_chat_log(
            event="generate_error",
            kb=kb,
            conversation_id=conversation_id,
            provider=provider,
            model=chat_model,
            abstained=False,
            chunk_indexed=int(chunk_n or 0),
            chunks_retrieved=len(retrieved),
            top_distance=top_distance,
            embed_ms=embed_ms,
            retrieve_ms=retrieve_ms,
            generate_ms=generate_ms,
            total_ms=total_ms,
        )
        return JSONResponse(
            {"error": f"Error del modelo: {message}"},
            status_code=status,
        )

    citations = _citations_from_used(used)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _insert_assistant_message(conn, conversation_id, reply, citations)

    total_ms = (time.perf_counter() - t_total0) * 1000
    _rag_chat_log(
        event="complete",
        kb=kb,
        conversation_id=conversation_id,
        provider=provider,
        model=chat_model,
        abstained=False,
        chunk_indexed=int(chunk_n or 0),
        chunks_retrieved=len(retrieved),
        top_distance=top_distance,
        embed_ms=embed_ms,
        retrieve_ms=retrieve_ms,
        generate_ms=generate_ms,
        total_ms=total_ms,
    )

    return {
        "reply": reply,
        "citations": citations,
        "knowledgeBaseId": kb,
        "conversationId": conversation_id,
        "abstained": False,
    }


async def _chat_sse_events(
    body: ChatBody,
    creds: dict[str, str] | None,
) -> AsyncIterator[str]:
    t_total0 = time.perf_counter()
    last_user = next(
        (m for m in reversed(body.messages or []) if m.role == "user"),
        None,
    )
    if not last_user or not last_user.content.strip():
        yield _sse({"type": "error", "httpStatus": 400, "message": "Falta un mensaje del usuario"})
        return

    kb = (body.knowledgeBaseId or "").strip()
    if not kb or not UUID_RE.match(kb):
        yield _sse({"type": "error", "httpStatus": 400, "message": "knowledgeBaseId UUID inválido o ausente"})
        return

    if not creds:
        yield _sse(
            {
                "type": "error",
                "httpStatus": 401,
                "message": (
                    "Falta la API key. Configúrala en Ajustes o define OPENAI_API_KEY / "
                    "GOOGLE_API_KEY en el servidor del API."
                ),
            }
        )
        return

    settings = await read_app_settings()
    provider = creds["provider"]
    chat_model = resolve_chat_model_for_provider(provider, settings)
    user_text = last_user.content.strip()
    pool = get_pool()

    embed_ms = retrieve_ms = generate_ms = 0.0
    top_distance: float | None = None

    async with pool.acquire() as conn:
        chunk_n = await conn.fetchval(
            """
            SELECT count(*)::int FROM chunks
            WHERE knowledge_base_id = $1::uuid AND embedding IS NOT NULL
            """,
            kb,
        )

    async with pool.acquire() as conn:
        async with conn.transaction():
            conversation_id = await _resolve_conversation_insert_user(
                conn, kb=kb, conversation_id=body.conversationId, user_text=user_text
            )

    yield _sse({"type": "meta", "conversationId": conversation_id, "knowledgeBaseId": kb})

    if not chunk_n:
        reply = (
            "No hay fragmentos indexados en esta base de conocimiento. Sube un PDF o TXT "
            "y espera a que el estado pase a **indexed**."
        )
        async with pool.acquire() as conn:
            async with conn.transaction():
                await _insert_assistant_message(conn, conversation_id, reply, [])
        total_ms = (time.perf_counter() - t_total0) * 1000
        _rag_chat_log(
            event="complete",
            kb=kb,
            conversation_id=conversation_id,
            provider=provider,
            model=chat_model,
            abstained=True,
            chunk_indexed=0,
            chunks_retrieved=0,
            top_distance=None,
            embed_ms=0,
            retrieve_ms=0,
            generate_ms=0,
            total_ms=total_ms,
        )
        yield _sse(
            {
                "type": "done",
                "reply": reply,
                "citations": [],
                "abstained": True,
                "conversationId": conversation_id,
            }
        )
        return

    try:
        t_embed0 = time.perf_counter()
        [q_vec] = await embed_texts_unified(
            provider,
            creds["apiKey"],
            [user_text],
            task_type="retrieval_query",
        )
        embed_ms = (time.perf_counter() - t_embed0) * 1000
    except Exception as e:
        message, status = _map_provider_exception(provider, e)
        total_ms = (time.perf_counter() - t_total0) * 1000
        _rag_chat_log(
            event="embed_error",
            kb=kb,
            conversation_id=conversation_id,
            provider=provider,
            model=chat_model,
            abstained=False,
            chunk_indexed=int(chunk_n or 0),
            chunks_retrieved=0,
            top_distance=None,
            embed_ms=embed_ms,
            retrieve_ms=0,
            generate_ms=0,
            total_ms=total_ms,
        )
        yield _sse({"type": "error", "httpStatus": status, "message": message})
        return

    t_ret0 = time.perf_counter()
    async with pool.acquire() as conn:
        retrieved = await retrieve_similar_chunks(conn, kb, q_vec, RETRIEVAL_TOP_K)
    retrieve_ms = (time.perf_counter() - t_ret0) * 1000
    if retrieved:
        top_distance = float(retrieved[0].distance)

    if not retrieved or retrieved[0].distance > MAX_COSINE_DISTANCE:
        reply = (
            "No encontré en tus documentos indexados información suficientemente relacionada con esa pregunta, "
            "así que no invento una respuesta. Prueba reformular o sube más material al respecto."
        )
        async with pool.acquire() as conn:
            async with conn.transaction():
                await _insert_assistant_message(conn, conversation_id, reply, [])
        total_ms = (time.perf_counter() - t_total0) * 1000
        _rag_chat_log(
            event="complete",
            kb=kb,
            conversation_id=conversation_id,
            provider=provider,
            model=chat_model,
            abstained=True,
            chunk_indexed=int(chunk_n or 0),
            chunks_retrieved=len(retrieved),
            top_distance=top_distance,
            embed_ms=embed_ms,
            retrieve_ms=retrieve_ms,
            generate_ms=0,
            total_ms=total_ms,
        )
        yield _sse(
            {
                "type": "done",
                "reply": reply,
                "citations": [],
                "abstained": True,
                "conversationId": conversation_id,
            }
        )
        return

    used = [r for r in retrieved if r.distance <= MAX_COSINE_DISTANCE]
    system = _build_system_prompt(used)
    hist_raw = [m for m in (body.messages or []) if m.role in ("user", "assistant")][-10:]
    history: list[dict[str, str]] = [
        {"role": m.role, "content": m.content[:12000]} for m in hist_raw
    ]
    citations = _citations_from_used(used)

    t_gen0 = time.perf_counter()
    models_to_try = (
        _google_fallback_chain(chat_model) if provider == "google" else [chat_model]
    )
    generate_exc: Exception | None = None
    model_used = chat_model
    reply = ""

    # Con varios modelos (fallback Google) no streameamos hasta saber cuál respondió:
    # evita deltas de un modelo y error del siguiente.
    if len(models_to_try) > 1:
        reply_sync: str | None = None
        for attempt_model in models_to_try:
            try:
                if attempt_model != chat_model:
                    logger.warning(
                        "Cuota diaria agotada para %s → intentando fallback con %s",
                        chat_model,
                        attempt_model,
                    )
                reply_sync = await generate_chat_reply(
                    provider=provider,
                    model=attempt_model,
                    system=system,
                    history=history,
                    api_key=creds["apiKey"],
                )
                model_used = attempt_model
                if attempt_model != chat_model:
                    logger.info("Fallback exitoso con %s", attempt_model)
                generate_exc = None
                break
            except Exception as e:
                generate_exc = e
                if provider == "google" and is_google_daily_quota_exhausted(e):
                    continue
                break
        generate_ms = (time.perf_counter() - t_gen0) * 1000
        reply = (reply_sync or "").strip()
        if reply:
            step = 72
            for i in range(0, len(reply_sync or ""), step):
                piece = (reply_sync or "")[i : i + step]
                if piece:
                    yield _sse({"type": "delta", "text": piece})
    else:
        reply_parts: list[str] = []
        attempt_model = models_to_try[0]
        try:
            async for piece in stream_chat_reply_tokens(
                provider=provider,
                model=attempt_model,
                system=system,
                history=history,
                api_key=creds["apiKey"],
            ):
                reply_parts.append(piece)
                if piece:
                    yield _sse({"type": "delta", "text": piece})
            model_used = attempt_model
        except Exception as e:
            generate_exc = e
        generate_ms = (time.perf_counter() - t_gen0) * 1000
        reply = "".join(reply_parts).strip()

    if generate_exc is not None or not reply:
        exc = generate_exc or RuntimeError("No se pudo generar respuesta")
        message, status = _map_provider_exception(provider, exc)
        if provider == "google" and is_google_daily_quota_exhausted(exc) and len(models_to_try) > 1:
            message = (
                "⚠️ Cuota diaria agotada en todos los modelos de Google disponibles. "
                "Opciones: (1) espera hasta mañana (renueva cada 24 h), "
                "(2) activa facturación en console.cloud.google.com, "
                "o (3) cambia a OpenAI en Ajustes IA."
            )
        total_ms = (time.perf_counter() - t_total0) * 1000
        _rag_chat_log(
            event="generate_error",
            kb=kb,
            conversation_id=conversation_id,
            provider=provider,
            model=chat_model,
            abstained=False,
            chunk_indexed=int(chunk_n or 0),
            chunks_retrieved=len(retrieved),
            top_distance=top_distance,
            embed_ms=embed_ms,
            retrieve_ms=retrieve_ms,
            generate_ms=generate_ms,
            total_ms=total_ms,
        )
        yield _sse({"type": "error", "httpStatus": status, "message": message})
        return

    async with pool.acquire() as conn:
        async with conn.transaction():
            await _insert_assistant_message(conn, conversation_id, reply, citations)

    total_ms = (time.perf_counter() - t_total0) * 1000
    _rag_chat_log(
        event="complete",
        kb=kb,
        conversation_id=conversation_id,
        provider=provider,
        model=model_used,
        abstained=False,
        chunk_indexed=int(chunk_n or 0),
        chunks_retrieved=len(retrieved),
        top_distance=top_distance,
        embed_ms=embed_ms,
        retrieve_ms=retrieve_ms,
        generate_ms=generate_ms,
        total_ms=total_ms,
    )
    yield _sse(
        {
            "type": "done",
            "reply": reply,
            "citations": citations,
            "abstained": False,
            "conversationId": conversation_id,
        }
    )


@router.post("/chat/stream")
async def chat_stream(
    body: ChatBody,
    creds: dict[str, str] | None = Depends(parse_ai_creds),
):
    gen = _chat_sse_events(body, creds)
    return StreamingResponse(
        gen,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
