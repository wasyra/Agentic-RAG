from __future__ import annotations

"""
Evaluaciones ligeras de RAG (sin llamar al LLM): citas, abstención textual, limpieza en BD.
"""

from app.routers.chat import citations_for_reply
from app.services.retrieve import RetrievedChunk


def test_eval_known_answer_style_citation_alignment() -> None:
    """Respuesta que cita [1] debe anclar la cita al primer fragmento recuperado."""
    used = [
        RetrievedChunk(
            chunk_id="c1",
            document_id="d1",
            title="Manual",
            content="El código secreto es RAG-EVAL-42.",
            page=1,
            distance=0.05,
        ),
    ]
    reply = "El código secreto es RAG-EVAL-42 [1]."
    cites = citations_for_reply(used, reply)
    assert len(cites) == 1
    assert cites[0]["chunkId"] == "c1"


def test_eval_unsupported_question_no_numeric_citations_keeps_panel() -> None:
    """Sin [n] en la respuesta, no se filtran citas (p. ej. panel de contexto completo)."""
    used = [
        RetrievedChunk(
            chunk_id="x",
            document_id="d9",
            title="X",
            content="contexto",
            page=None,
            distance=0.1,
        ),
    ]
    abstention = (
        "No encontré en tus documentos indexados información suficientemente relacionada "
        "con esa pregunta."
    )
    cites = citations_for_reply(used, abstention)
    assert len(cites) == 1
