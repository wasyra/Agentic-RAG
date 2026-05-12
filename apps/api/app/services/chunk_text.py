"""Trocea texto largo con solapamiento para RAG (misma lógica que apps/web chunk-text.ts)."""


def chunk_text(text: str, max_chars: int = 1600, overlap: int = 200) -> list[str]:
    normalized = text.replace("\r\n", "\n").strip()
    if not normalized:
        return []

    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(len(normalized), start + max_chars)
        if end < len(normalized):
            space = normalized.rfind("\n", start, end)
            space2 = normalized.rfind(" ", start, end)
            cut = max(space, space2)
            if cut > start + max_chars // 2:
                end = cut
        piece = normalized[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(normalized):
            break
        start = max(end - overlap, start + 1)
    return chunks
