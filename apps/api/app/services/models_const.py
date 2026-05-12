"""Constantes de modelos y proveedores (alineadas con apps/web/src/lib/models.ts)."""

EMBEDDING_DIMENSIONS = 768

AI_PROVIDERS = [
    {"id": "openai", "label": "OpenAI (GPT + embeddings)"},
    {"id": "google", "label": "Google (Gemini + embeddings)"},
]

OPENAI_CHAT_MODELS = [
    {"id": "gpt-4o-mini", "label": "GPT-4o mini (rápido / económico)"},
    {"id": "gpt-4o", "label": "GPT-4o"},
    {"id": "gpt-4-turbo", "label": "GPT-4 Turbo"},
    {"id": "gpt-3.5-turbo", "label": "GPT-3.5 Turbo"},
    {"id": "gpt-4.1-mini", "label": "GPT-4.1 mini"},
    {"id": "gpt-4.1", "label": "GPT-4.1"},
]

GOOGLE_CHAT_MODELS = [
    {"id": "gemini-2.0-flash", "label": "Gemini 2.0 Flash (recomendado / estable)"},
    {"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash"},
    {"id": "gemini-2.5-pro", "label": "Gemini 2.5 Pro"},
]

# Orden de fallback automático cuando la cuota diaria de un modelo se agota.
# Se intenta el siguiente antes de devolver error al usuario.
GOOGLE_MODEL_FALLBACK_ORDER = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"]

# IDs antiguos guardados en app-settings.json → equivalentes actuales (API v1beta).
LEGACY_GOOGLE_CHAT_MODEL: dict[str, str] = {
    "gemini-1.5-flash": "gemini-2.5-flash",
    "gemini-1.5-flash-8b": "gemini-2.5-flash",
    "gemini-1.5-flash-latest": "gemini-2.5-flash",
    "gemini-1.5-pro": "gemini-2.5-pro",
    "gemini-1.5-pro-latest": "gemini-2.5-pro",
    "gemini-pro": "gemini-2.5-flash",
}

DEFAULT_AI_PROVIDER = "openai"
DEFAULT_OPENAI_CHAT_MODEL = "gpt-4o-mini"
DEFAULT_GOOGLE_CHAT_MODEL = "gemini-2.0-flash"

OPENAI_SET = {m["id"] for m in OPENAI_CHAT_MODELS}
GOOGLE_SET = {m["id"] for m in GOOGLE_CHAT_MODELS}


def normalize_google_chat_model_id(model: str) -> str:
    m = (model or "").strip()
    if m.startswith("models/"):
        m = m[len("models/") :]
    return LEGACY_GOOGLE_CHAT_MODEL.get(m, m)


def is_allowed_ai_provider(pid: str) -> bool:
    return pid in ("openai", "google")


def is_allowed_chat_model_for_provider(provider: str, model: str) -> bool:
    if provider == "openai":
        return model in OPENAI_SET
    mid = normalize_google_chat_model_id(model)
    return mid in GOOGLE_SET


def default_chat_model_for_provider(provider: str) -> str:
    return DEFAULT_GOOGLE_CHAT_MODEL if provider == "google" else DEFAULT_OPENAI_CHAT_MODEL


def resolve_ai_provider(file: dict | None) -> str:
    if not file:
        return DEFAULT_AI_PROVIDER
    p = str(file.get("chatProvider") or "").strip().lower()
    if p == "google":
        return "google"
    if p == "anthropic":
        return "openai"
    return DEFAULT_AI_PROVIDER


def resolve_chat_model_for_provider(provider: str, file: dict | None) -> str:
    m = str(file.get("chatModel") or "").strip() if file else ""
    if m == "gemini-2.0-flash-lite":
        m = "gemini-2.0-flash"
    if provider == "google":
        m = normalize_google_chat_model_id(m)
    if m and is_allowed_chat_model_for_provider(provider, m):
        return m
    return default_chat_model_for_provider(provider)
