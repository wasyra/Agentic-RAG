from __future__ import annotations

import asyncio
import io
from dataclasses import dataclass

from pypdf import PdfReader

from app.services.chunk_text import chunk_text


@dataclass
class ChunkDraft:
    content: str
    page: int | None
    chunk_index: int


def _ext_of(file_name: str) -> str:
    i = file_name.rfind(".")
    return file_name[i + 1 :].lower() if i >= 0 else ""


async def extract_document_chunks(
    storage_path: str,
    file_name: str,
    mime_type: str | None,
) -> list[ChunkDraft]:
    ext = _ext_of(file_name)
    def _read() -> bytes:
        with open(storage_path, "rb") as f:
            return f.read()

    buf = await asyncio.to_thread(_read)

    is_pdf = ext == "pdf" or mime_type == "application/pdf" or (
        mime_type and "pdf" in mime_type
    )
    is_plain = ext in ("txt", "md") or mime_type in ("text/plain", "text/markdown")

    if is_pdf:
        reader = PdfReader(io.BytesIO(buf))
        page_texts: list[str] = []
        for page in reader.pages:
            page_texts.append((page.extract_text() or "").strip())
        combined = "\f".join(page_texts)
        out: list[ChunkDraft] = []
        chunk_index = 0
        parts_by_ff = [s.strip() for s in combined.split("\f") if s.strip()]
        if len(parts_by_ff) > 1:
            for i, page_text in enumerate(parts_by_ff):
                page_num = i + 1
                for c in chunk_text(page_text):
                    out.append(
                        ChunkDraft(content=c, page=page_num, chunk_index=chunk_index)
                    )
                    chunk_index += 1
        else:
            full = "\n".join(page_texts) if page_texts else ""
            numpages = len(reader.pages)
            for c in chunk_text(full):
                out.append(
                    ChunkDraft(
                        content=c,
                        page=1 if numpages == 1 else None,
                        chunk_index=chunk_index,
                    )
                )
                chunk_index += 1
        return out

    if is_plain:
        text = buf.decode("utf-8", errors="replace")
        drafts: list[ChunkDraft] = []
        for i, content in enumerate(chunk_text(text)):
            drafts.append(ChunkDraft(content=content, page=None, chunk_index=i))
        return drafts

    raise ValueError(
        f"Formato no soportado ({ext or mime_type or 'desconocido'}). Usa PDF, TXT o MD."
    )
