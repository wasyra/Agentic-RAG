from fastapi import APIRouter
from pydantic import BaseModel

from app.services.app_settings import merge_app_settings, read_app_settings
from app.services.models_const import (
    AI_PROVIDERS,
    GOOGLE_CHAT_MODELS,
    OPENAI_CHAT_MODELS,
    resolve_ai_provider,
    resolve_chat_model_for_provider,
)

router = APIRouter(tags=["settings"])


class SettingsPostBody(BaseModel):
    chatProvider: str | None = None
    chatModel: str | None = None


def _settings_payload(file: dict):
    chat_provider = resolve_ai_provider(file)
    return {
        "chatProvider": chat_provider,
        "chatModel": resolve_chat_model_for_provider(chat_provider, file),
        "aiProviders": AI_PROVIDERS,
        "openaiChatModels": OPENAI_CHAT_MODELS,
        "googleChatModels": GOOGLE_CHAT_MODELS,
    }


@router.get("/settings")
async def get_settings():
    file = await read_app_settings()
    return _settings_payload(file)


@router.post("/settings")
async def post_settings(body: SettingsPostBody):
    patch = body.model_dump(exclude_unset=True, exclude_none=True)
    try:
        merged = await merge_app_settings(patch)
    except ValueError as e:
        from fastapi.responses import JSONResponse

        return JSONResponse({"error": str(e)}, status_code=400)
    return _settings_payload(merged)
