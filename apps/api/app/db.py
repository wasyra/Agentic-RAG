from __future__ import annotations

import asyncpg

from app.config import settings

pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global pool
    if pool is not None:
        return
    pool = await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=1,
        max_size=10,
        statement_cache_size=0,
    )


async def close_pool() -> None:
    global pool
    if pool is not None:
        await pool.close()
        pool = None


def get_pool() -> asyncpg.Pool:
    if pool is None:
        raise RuntimeError("Database pool not initialized")
    return pool
