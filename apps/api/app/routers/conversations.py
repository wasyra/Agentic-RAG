from __future__ import annotations

import json
import re
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query

from app.db import get_pool

router = APIRouter(tags=["conversations"])

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)


@router.get("/conversations")
async def list_conversations(
    knowledgeBaseId: Annotated[str | None, Query()] = None,
):
    if not knowledgeBaseId or not UUID_RE.match(knowledgeBaseId):
        raise HTTPException(status_code=400, detail="Query knowledgeBaseId UUID requerido")
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, title, created_at, updated_at
            FROM conversations
            WHERE knowledge_base_id = $1::uuid
            ORDER BY updated_at DESC
            LIMIT 100
            """,
            knowledgeBaseId,
        )
    return {
        "conversations": [
            {
                "id": str(r["id"]),
                "title": r["title"],
                "createdAt": r["created_at"].isoformat(),
                "updatedAt": r["updated_at"].isoformat(),
            }
            for r in rows
        ]
    }


@router.post("/conversations")
async def create_conversation(body: dict[str, Any]):
    kb = str(body.get("knowledgeBaseId") or "").strip()
    if not kb or not UUID_RE.match(kb):
        raise HTTPException(status_code=400, detail="knowledgeBaseId UUID inválido")
    title = body.get("title")
    title_s = str(title).strip()[:512] if title is not None else None
    pool = get_pool()
    async with pool.acquire() as conn:
        kb_row = await conn.fetchrow(
            "SELECT id FROM knowledge_bases WHERE id = $1::uuid LIMIT 1",
            kb,
        )
        if not kb_row:
            raise HTTPException(status_code=404, detail="Base de conocimiento no encontrada")
        row = await conn.fetchrow(
            """
            INSERT INTO conversations (knowledge_base_id, title)
            VALUES ($1::uuid, $2)
            RETURNING id, created_at
            """,
            kb,
            title_s,
        )
    return {
        "conversation": {
            "id": str(row["id"]),
            "createdAt": row["created_at"].isoformat(),
        }
    }


@router.get("/conversations/{conversation_id}/messages")
async def list_messages(conversation_id: str):
    if not conversation_id or not UUID_RE.match(conversation_id):
        raise HTTPException(status_code=400, detail="conversationId inválido")
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, role, content, citations_json, created_at
            FROM messages
            WHERE conversation_id = $1::uuid
            ORDER BY created_at ASC
            """,
            conversation_id,
        )
    out: list[dict[str, Any]] = []
    for r in rows:
        item: dict[str, Any] = {
            "id": str(r["id"]),
            "role": r["role"],
            "content": r["content"],
            "createdAt": r["created_at"].isoformat(),
        }
        raw = r["citations_json"]
        if raw:
            try:
                item["citations"] = json.loads(raw)
            except json.JSONDecodeError:
                item["citations"] = []
        out.append(item)
    return {"messages": out}
