from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from app.services.index_queue import INDEX_CRED_KEY_PREFIX, QUEUE_KEY, enqueue_index_job


@pytest.mark.asyncio
async def test_enqueue_with_server_key_payload_has_no_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/15")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-server-test-only")

    class FakeRedis:
        def __init__(self) -> None:
            self._lists: dict[str, list[str]] = {QUEUE_KEY: []}
            self._kv: dict[str, str] = {}

        async def setex(self, key: str, _ttl: int, value: str) -> None:
            raise AssertionError("no debe guardar credencial efímera si hay clave de servidor")

        async def rpush(self, key: str, value: str) -> None:
            self._lists.setdefault(key, []).append(value)

        async def aclose(self) -> None:
            return None

    fake = FakeRedis()

    def fake_from_url(_url: str, **_kw: object) -> FakeRedis:
        return fake

    async def fake_settings() -> dict:
        return {}

    with patch("redis.asyncio.from_url", fake_from_url):
        with patch(
            "app.services.index_queue.read_app_settings",
            AsyncMock(side_effect=fake_settings),
        ):
            ok = await enqueue_index_job("550e8400-e29b-41d4-a716-446655440000", None)
    assert ok is True
    assert len(fake._lists[QUEUE_KEY]) == 1
    payload = json.loads(fake._lists[QUEUE_KEY][0])
    assert payload == {"document_id": "550e8400-e29b-41d4-a716-446655440000"}
    assert "api_key" not in json.dumps(payload)


@pytest.mark.asyncio
async def test_enqueue_without_server_stores_key_ref(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/15")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    class FakeRedis:
        def __init__(self) -> None:
            self._lists: dict[str, list[str]] = {QUEUE_KEY: []}
            self._kv: dict[str, str] = {}

        async def setex(self, key: str, _ttl: int, value: str) -> None:
            self._kv[key] = value

        async def rpush(self, key: str, value: str) -> None:
            self._lists.setdefault(key, []).append(value)

        async def aclose(self) -> None:
            return None

    fake = FakeRedis()

    def fake_from_url(_url: str, **_kw: object) -> FakeRedis:
        return fake

    async def fake_settings() -> dict:
        return {}

    creds = {"provider": "openai", "apiKey": "sk-user-ephemeral"}
    with patch("redis.asyncio.from_url", fake_from_url):
        with patch(
            "app.services.index_queue.read_app_settings",
            AsyncMock(side_effect=fake_settings),
        ):
            ok = await enqueue_index_job("550e8400-e29b-41d4-a716-446655440001", creds)
    assert ok is True
    payload = json.loads(fake._lists[QUEUE_KEY][0])
    assert payload["document_id"] == "550e8400-e29b-41d4-a716-446655440001"
    assert "key_ref" in payload
    assert "api_key" not in payload
    ref = payload["key_ref"]
    cred_key = INDEX_CRED_KEY_PREFIX + ref
    assert cred_key in fake._kv
    inner = json.loads(fake._kv[cred_key])
    assert inner["apiKey"] == "sk-user-ephemeral"
