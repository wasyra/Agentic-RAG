from __future__ import annotations

import logging
import re
import uuid
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from app.db import get_pool
from app.routers.deps import AiCredsDep
from app.services.index_document import index_document
from app.services.index_queue import enqueue_index_job
from app.services.storage_path import relative_upload_path, resolve_stored_upload_path

logger = logging.getLogger(__name__)
router = APIRouter(tags=["documents"])

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)


def _safe_file_name(name: str) -> str:
    return re.sub(r"[^\w.\-()\s\u00C0-\u024F]", "_", name)[:200]


async def _run_index_safe(document_id: str, creds: dict | None) -> None:
    try:
        await index_document(document_id, creds)
    except Exception:
        logger.exception("[indexDocument] %s", document_id)


@router.get("/documents")
async def list_documents(knowledgeBaseId: Annotated[str | None, Query()] = None):
    if not knowledgeBaseId:
        raise HTTPException(status_code=400, detail="Query knowledgeBaseId requerido")
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, title, file_name, status, status_message, created_at
            FROM documents
            WHERE knowledge_base_id = $1::uuid
            ORDER BY created_at DESC
            """,
            knowledgeBaseId,
        )
    return {
        "documents": [
            {
                "id": str(r["id"]),
                "title": r["title"],
                "fileName": r["file_name"],
                "status": r["status"],
                "statusMessage": r["status_message"],
                "createdAt": r["created_at"].isoformat(),
            }
            for r in rows
        ]
    }


@router.post("/documents")
async def upload_document(
    background_tasks: BackgroundTasks,
    creds: AiCredsDep,
    file: UploadFile = File(...),
    knowledgeBaseId: str = Form(...),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        kb = await conn.fetchrow(
            "SELECT id FROM knowledge_bases WHERE id = $1::uuid LIMIT 1",
            knowledgeBaseId,
        )
    if not kb:
        raise HTTPException(status_code=404, detail="Base de conocimiento no encontrada")

    if not file.filename:
        raise HTTPException(status_code=400, detail="Archivo requerido")
    body = await file.read()
    if not body:
        raise HTTPException(status_code=400, detail="Archivo requerido")

    safe_name = _safe_file_name(file.filename)
    stored_name = f"{uuid.uuid4()}_{safe_name}"
    storage_path_for_db = relative_upload_path(knowledgeBaseId, stored_name)
    absolute_path = resolve_stored_upload_path(storage_path_for_db)
    absolute_path.parent.mkdir(parents=True, exist_ok=True)
    absolute_path.write_bytes(body)

    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO documents (
              knowledge_base_id, title, file_name, mime_type, storage_path,
              status, status_message
            ) VALUES ($1::uuid, $2, $3, $4, $5, 'pending',
              'En cola para indexación (pipeline pendiente)')
            RETURNING id, title, status
            """,
            knowledgeBaseId,
            file.filename,
            safe_name,
            file.content_type,
            storage_path_for_db,
        )

    if not row:
        raise HTTPException(status_code=500, detail="No se pudo crear el documento")

    doc_id = str(row["id"])
    creds_dict = {"provider": creds["provider"], "apiKey": creds["apiKey"]} if creds else None
    enqueued = False
    if creds_dict:
        enqueued = await enqueue_index_job(doc_id, creds_dict)
    if not enqueued:
        background_tasks.add_task(_run_index_safe, doc_id, creds_dict)

    return {
        "document": {
            "id": doc_id,
            "title": row["title"],
            "status": row["status"],
        }
    }


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str):
    if not doc_id or not UUID_RE.match(doc_id):
        raise HTTPException(status_code=400, detail="Id de documento inválido")

    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, storage_path FROM documents WHERE id = $1::uuid LIMIT 1",
            doc_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    abs_path = resolve_stored_upload_path(row["storage_path"])
    try:
        abs_path.unlink(missing_ok=True)
    except OSError as e:
        logger.warning("[delete document] archivo en disco: %s", e)

    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM documents WHERE id = $1::uuid", doc_id)

    return {"ok": True}


@router.post("/documents/{doc_id}/reindex")
async def reindex_document(
    doc_id: str,
    background_tasks: BackgroundTasks,
    creds: AiCredsDep,
):
    if not doc_id or not UUID_RE.match(doc_id):
        raise HTTPException(status_code=400, detail="Id de documento inválido")
    creds_dict = {"provider": creds["provider"], "apiKey": creds["apiKey"]} if creds else None
    enqueued = False
    if creds_dict:
        enqueued = await enqueue_index_job(doc_id, creds_dict)
    if not enqueued:
        background_tasks.add_task(_run_index_safe, doc_id, creds_dict)
    return {"ok": True, "message": "Indexación en segundo plano"}
