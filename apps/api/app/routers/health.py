from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.db import get_pool

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.execute("SELECT 1")
        return {"ok": True, "database": "connected"}
    except Exception as e:
        return JSONResponse(
            {"ok": False, "database": "error", "message": str(e)},
            status_code=503,
        )
