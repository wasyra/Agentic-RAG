from __future__ import annotations

from dataclasses import dataclass

import asyncpg

from app.services.models_const import EMBEDDING_DIMENSIONS


@dataclass
class RetrievedChunk:
    chunk_id: str
    document_id: str
    title: str
    content: str
    page: int | None
    distance: float


async def retrieve_similar_chunks(
    conn: asyncpg.Connection,
    knowledge_base_id: str,
    query_embedding: list[float],
    limit: int = 8,
) -> list[RetrievedChunk]:
    if len(query_embedding) != EMBEDDING_DIMENSIONS:
        raise ValueError("Vector de consulta inválido")
    vec_literal = "[" + ",".join(str(x) for x in query_embedding) + "]"
    rows = await conn.fetch(
        """
        SELECT
          c.id AS chunk_id,
          c.document_id,
          d.title,
          c.content,
          c.page,
          (c.embedding <=> $2::vector) AS distance
        FROM chunks c
        INNER JOIN documents d ON d.id = c.document_id
        WHERE c.knowledge_base_id = $1::uuid
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> $2::vector
        LIMIT $3
        """,
        knowledge_base_id,
        vec_literal,
        limit,
    )
    out: list[RetrievedChunk] = []
    for r in rows:
        out.append(
            RetrievedChunk(
                chunk_id=str(r["chunk_id"]),
                document_id=str(r["document_id"]),
                title=r["title"],
                content=r["content"],
                page=r["page"],
                distance=float(r["distance"]),
            )
        )
    return out
