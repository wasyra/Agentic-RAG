from __future__ import annotations

from typing import Any

from app.db import get_pool
from app.services.app_settings import read_app_settings
from app.services.embeddings import embed_texts_unified
from app.services.extract_document import extract_document_chunks
from app.services.models_const import resolve_ai_provider
from app.services.storage_path import resolve_stored_upload_path


def _err_message(e: BaseException) -> str:
    return str(e) if isinstance(e, Exception) else str(e)


async def index_document(document_id: str, creds: dict[str, Any] | None) -> None:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, knowledge_base_id, title, file_name, mime_type, storage_path
            FROM documents WHERE id = $1::uuid
            """,
            document_id,
        )
        if not row:
            return

        await conn.execute(
            """
            UPDATE documents
            SET status = 'processing',
                status_message = $2,
                updated_at = now()
            WHERE id = $1::uuid
            """,
            document_id,
            "Extrayendo texto y generando embeddings…",
        )

    try:
        if not (creds and str(creds.get("apiKey") or "").strip()):
            raise ValueError(
                "Falta la API key en la petición. Configúrala en Ajustes (navegador) "
                "y vuelve a subir o pulsa Reindexar."
            )

        settings = await read_app_settings()
        provider = str(creds.get("provider") or "").strip() or resolve_ai_provider(
            settings
        )
        api_key = str(creds["apiKey"]).strip()

        abs_path = str(resolve_stored_upload_path(row["storage_path"]))
        drafts = await extract_document_chunks(
            abs_path,
            row["file_name"],
            row["mime_type"],
        )
        if not drafts:
            raise ValueError("No se obtuvo texto indexable del archivo.")

        contents = [d.content for d in drafts]
        vectors = await embed_texts_unified(provider, api_key, contents)

        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "DELETE FROM chunks WHERE document_id = $1::uuid",
                    document_id,
                )
                for d, vec in zip(drafts, vectors, strict=True):
                    vec_literal = "[" + ",".join(str(x) for x in vec) + "]"
                    await conn.execute(
                        """
                        INSERT INTO chunks (
                          knowledge_base_id, document_id, content, page, chunk_index, embedding
                        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::vector)
                        """,
                        row["knowledge_base_id"],
                        document_id,
                        d.content,
                        d.page,
                        d.chunk_index,
                        vec_literal,
                    )
                await conn.execute(
                    """
                    UPDATE documents
                    SET status = 'indexed', status_message = NULL, updated_at = now()
                    WHERE id = $1::uuid
                    """,
                    document_id,
                )
    except BaseException as e:
        msg = _err_message(e)[:2000]
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE documents
                SET status = 'error', status_message = $2, updated_at = now()
                WHERE id = $1::uuid
                """,
                document_id,
                msg,
            )
