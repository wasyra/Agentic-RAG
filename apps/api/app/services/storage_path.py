from __future__ import annotations

import re
from pathlib import Path

from app.config import settings


def get_storage_root() -> Path:
    return Path(settings.storage_root).resolve()


def relative_upload_path(knowledge_base_id: str, stored_file_name: str) -> str:
    return f"uploads/{knowledge_base_id}/{stored_file_name}".replace("\\", "/")


def _extract_uploads_relative(any_path: str) -> str | None:
    norm = any_path.replace("\\", "/")
    m = re.search(r"(?:^|/)storage/uploads/(.+)$", norm)
    if m:
        return f"uploads/{m.group(1)}".replace("\\", "/")
    m2 = re.search(r"(?:^|/)uploads/(.+)$", norm)
    if m2:
        return f"uploads/{m2.group(1)}".replace("\\", "/")
    return None


def resolve_stored_upload_path(stored: str) -> Path:
    trimmed = stored.strip()
    if not trimmed:
        return Path(trimmed)
    as_posix = trimmed.replace("\\", "/")
    root = get_storage_root()

    if as_posix.startswith("uploads/"):
        segments = [s for s in as_posix.split("/") if s]
        return (root.joinpath(*segments)).resolve()

    p = Path(trimmed)
    if p.is_absolute():
        if p.exists():
            return p.resolve()
        rel = _extract_uploads_relative(trimmed)
        if rel:
            segments = [s for s in rel.split("/") if s]
            rebased = (root.joinpath(*segments)).resolve()
            if rebased.exists():
                return rebased
        return p.resolve()

    return (root / trimmed).resolve()
