from __future__ import annotations

import os

import asyncpg
import pytest

from app.services.models_const import EMBEDDING_DIMENSIONS

pytestmark = pytest.mark.integration


def _database_url() -> str:
    return (os.environ.get("DATABASE_URL") or "").strip()


@pytest.mark.asyncio
async def test_delete_document_cascades_chunks() -> None:
    """
    Escenario delete-and-query: al borrar un documento no deben quedar chunks asociados.
    """
    url = _database_url()
    if not url:
        pytest.skip("DATABASE_URL no definido (levanta Postgres con pgvector).")

    vec = [0.001] * EMBEDDING_DIMENSIONS
    vec_literal = "[" + ",".join(str(x) for x in vec) + "]"

    conn = await asyncpg.connect(url)
    uid = kb_id = doc_id = None
    try:
        uid = await conn.fetchval(
            "INSERT INTO users (email) VALUES ($1) RETURNING id",
            "eval-cascade@local.test",
        )
        kb_id = await conn.fetchval(
            """
            INSERT INTO knowledge_bases (user_id, name)
            VALUES ($1::uuid, $2) RETURNING id
            """,
            uid,
            "eval-kb",
        )
        doc_id = await conn.fetchval(
            """
            INSERT INTO documents (
              knowledge_base_id, title, file_name, mime_type, storage_path, status
            ) VALUES ($1::uuid, $2, $3, $4, $5, 'indexed')
            RETURNING id
            """,
            kb_id,
            "Eval",
            "eval.txt",
            "text/plain",
            f"uploads/{kb_id}/eval.txt",
        )
        await conn.execute(
            """
            INSERT INTO chunks (
              knowledge_base_id, document_id, content, page, chunk_index, embedding
            ) VALUES ($1::uuid, $2::uuid, $3, NULL, 0, $4::vector)
            """,
            kb_id,
            doc_id,
            "contenido de prueba",
            vec_literal,
        )
        n_before = await conn.fetchval(
            "SELECT count(*)::int FROM chunks WHERE document_id = $1::uuid",
            doc_id,
        )
        assert int(n_before or 0) == 1

        await conn.execute("DELETE FROM documents WHERE id = $1::uuid", doc_id)

        n_after = await conn.fetchval(
            "SELECT count(*)::int FROM chunks WHERE document_id = $1::uuid",
            doc_id,
        )
        assert int(n_after or 0) == 0
    finally:
        if uid:
            await conn.execute("DELETE FROM users WHERE id = $1::uuid", uid)
        await conn.close()
