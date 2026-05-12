from fastapi import APIRouter

from app.db import get_pool

router = APIRouter(tags=["knowledge-bases"])


@router.get("/knowledge-bases")
async def list_knowledge_bases():
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, name, created_at
            FROM knowledge_bases
            ORDER BY created_at ASC
            """
        )
    return {
        "knowledgeBases": [
            {
                "id": str(r["id"]),
                "name": r["name"],
                "createdAt": r["created_at"].isoformat(),
            }
            for r in rows
        ]
    }
