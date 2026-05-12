from __future__ import annotations

import google.generativeai as genai
from openai import AsyncOpenAI

from app.services.google_backoff import run_google_sync_with_backoff
from app.services.models_const import EMBEDDING_DIMENSIONS

OPENAI_EMBED_MODEL = "text-embedding-3-small"
GOOGLE_EMBED_MODEL = "models/gemini-embedding-001"

# Google acepta hasta 100 textos por llamada batch; usamos 64 como margen seguro.
GOOGLE_BATCH = 64


def _google_batch_embed(
    texts: list[str],
    task_type: str,
    output_dimensionality: int,
) -> list[list[float]]:
    """
    1 llamada HTTP → N embeddings usando el batch nativo de genai.embed_content.
    Cuando `content` es un Iterable (no str/Mapping), el SDK llama internamente
    a batchEmbedContents, lo que reduce las llamadas a la API de N→1 por lote.
    """
    result = genai.embed_content(
        model=GOOGLE_EMBED_MODEL,
        content=texts,          # lista → batch automático
        task_type=task_type,
        output_dimensionality=output_dimensionality,
    )
    # Con content=list devuelve {"embedding": [[...], [...]]}
    embeddings = result.get("embedding")
    if not embeddings or not isinstance(embeddings[0], list):
        # Compatibilidad: a veces devuelve lista de floats si solo hay 1 texto
        embeddings = [embeddings]
    if len(embeddings) != len(texts):
        raise ValueError(
            f"Google batch: esperados {len(texts)} vectores, recibidos {len(embeddings)}"
        )
    out: list[list[float]] = []
    for v in embeddings:
        vec = list(v)
        if len(vec) != output_dimensionality:
            raise ValueError(
                f"Google batch: dimensión {len(vec)}, esperado {output_dimensionality}"
            )
        out.append(vec)
    return out


async def embed_texts_unified(
    provider: str,
    api_key: str,
    inputs: list[str],
    *,
    task_type: str = "retrieval_document",
) -> list[list[float]]:
    """
    task_type:
      "retrieval_document"  → indexar chunks de documentos
      "retrieval_query"     → embeddear la pregunta del usuario
    """
    if not inputs:
        return []

    if provider == "openai":
        client = AsyncOpenAI(api_key=api_key)
        out: list[list[float]] = []
        for i in range(0, len(inputs), 48):
            slice_ = inputs[i : i + 48]
            res = await client.embeddings.create(
                model=OPENAI_EMBED_MODEL,
                input=slice_,
                dimensions=EMBEDDING_DIMENSIONS,
            )
            sorted_rows = sorted(res.data, key=lambda x: x.index)
            for row in sorted_rows:
                emb = list(row.embedding)
                if len(emb) != EMBEDDING_DIMENSIONS:
                    raise ValueError(
                        f"OpenAI: dimensión {len(emb)}, esperado {EMBEDDING_DIMENSIONS}"
                    )
                out.append(emb)
        return out

    # --- Google: 1 llamada HTTP por lote en lugar de 1 por texto ---
    genai.configure(api_key=api_key)

    out: list[list[float]] = []
    for i in range(0, len(inputs), GOOGLE_BATCH):
        slice_ = inputs[i : i + GOOGLE_BATCH]
        batch_vecs = await run_google_sync_with_backoff(
            lambda s=slice_: _google_batch_embed(s, task_type, EMBEDDING_DIMENSIONS),
            call_type="embed",
            attempts=4,
        )
        out.extend(batch_vecs)
    return out
