from __future__ import annotations

from app.routers.chat import citation_indices_from_answer, citations_for_reply
from app.services.retrieve import RetrievedChunk


def test_citation_indices_from_answer_parses_brackets() -> None:
    assert citation_indices_from_answer("Ver [1] y también [2].") == {1, 2}
    assert citation_indices_from_answer("Sin citas aquí.") == set()
    assert citation_indices_from_answer("[ 3 ] texto") == {3}


def test_citations_for_reply_filters_when_brackets_present() -> None:
    used = [
        RetrievedChunk(
            chunk_id="a",
            document_id="d1",
            title="Doc",
            content="uno",
            page=1,
            distance=0.1,
        ),
        RetrievedChunk(
            chunk_id="b",
            document_id="d1",
            title="Doc",
            content="dos",
            page=1,
            distance=0.2,
        ),
    ]
    reply = "Solo el segundo fragmento aplica [2]."
    cites = citations_for_reply(used, reply)
    assert len(cites) == 1
    assert cites[0]["chunkId"] == "b"


def test_citations_for_reply_keeps_all_when_no_brackets() -> None:
    used = [
        RetrievedChunk(
            chunk_id="a",
            document_id="d1",
            title="Doc",
            content="uno",
            page=None,
            distance=0.1,
        ),
    ]
    cites = citations_for_reply(used, "Respuesta sin referencias numéricas.")
    assert len(cites) == 1
