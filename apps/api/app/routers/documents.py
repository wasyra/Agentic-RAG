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
from app.config import settings
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


def _ext_of(name: str) -> str:
    i = name.rfind(".")
    return name[i + 1 :].lower() if i >= 0 else ""


def _effective_upload_mime(filename: str, content_type: str | None) -> str:
    raw = (content_type or "").split(";")[0].strip().lower()
    ext = _ext_of(filename)
    if raw in ("", "application/octet-stream", "binary/octet-stream"):
        if ext == "pdf":
            return "application/pdf"
        if ext == "txt":
            return "text/plain"
        if ext in ("md", "markdown"):
            return "text/markdown"
    return raw


def _mime_allowed(filename: str, content_type: str | None) -> bool:
    eff = _effective_upload_mime(filename, content_type)
    allowed = settings.upload_allowed_mimes_list
    if eff in allowed:
        return True
    ext = _ext_of(filename)
    return ext in ("pdf", "txt", "md", "markdown") and "application/octet-stream" in allowed


async def _read_upload_limited(file: UploadFile) -> bytes:
    max_b = int(settings.max_upload_bytes)
    parts: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(min(1024 * 1024, max(1, max_b + 1 - total)))
        if not chunk:
            break
        total += len(chunk)
        if total > max_b:
            raise HTTPException(
                status_code=413,
                detail=f"El archivo supera el límite de {max_b} bytes.",
            )
        parts.append(chunk)
    return b"".join(parts)


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
        if kb:
            doc_count = await conn.fetchval(
                """
                SELECT count(*)::int FROM documents
                WHERE knowledge_base_id = $1::uuid
                """,
                knowledgeBaseId,
            )
        else:
            doc_count = 0
    if not kb:
        raise HTTPException(status_code=404, detail="Base de conocimiento no encontrada")

    if int(doc_count or 0) >= int(settings.max_documents_per_knowledge_base):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Se alcanzó el máximo de {settings.max_documents_per_knowledge_base} "
                "documentos por base de conocimiento."
            ),
        )

    if not file.filename:
        raise HTTPException(status_code=400, detail="Archivo requerido")

    if not _mime_allowed(file.filename, file.content_type):
        raise HTTPException(
            status_code=415,
            detail="Tipo de archivo no permitido. Sube PDF, TXT o MD (MIME acorde o extensión reconocible).",
        )

    body = await _read_upload_limited(file)
    if not body:
        raise HTTPException(status_code=400, detail="Archivo requerido")

    mime_for_db = _effective_upload_mime(file.filename, file.content_type)

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
            mime_for_db,
            storage_path_for_db,
        )

    if not row:
        raise HTTPException(status_code=500, detail="No se pudo crear el documento")

    doc_id = str(row["id"])
    creds_dict = {"provider": creds["provider"], "apiKey": creds["apiKey"]} if creds else None
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
    enqueued = await enqueue_index_job(doc_id, creds_dict)
    if not enqueued:
        background_tasks.add_task(_run_index_safe, doc_id, creds_dict)
    return {"ok": True, "message": "Indexación en segundo plano"}
