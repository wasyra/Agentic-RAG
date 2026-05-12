from __future__ import annotations

import google.generativeai as genai
from openai import AsyncOpenAI

from app.services.google_backoff import run_google_sync_with_backoff
from app.services.models_const import normalize_google_chat_model_id


async def generate_chat_reply(
    *,
    provider: str,
    model: str,
    system: str,
    history: list[dict[str, str]],
    api_key: str,
) -> str:
    if provider == "openai":
        client = AsyncOpenAI(api_key=api_key)
        messages = [{"role": "system", "content": system}, *history]
        completion = await client.chat.completions.create(
            model=model,
            temperature=0.15,
            max_tokens=1800,
            messages=messages,
        )
        msg = completion.choices[0].message.content
        return (msg or "").strip() or "No se generó texto de respuesta."

    genai.configure(api_key=api_key)

    def _run_google() -> str:
        model_id = normalize_google_chat_model_id(model)
        gen_model = genai.GenerativeModel(
            model_name=model_id,
            system_instruction=system,
        )
        prior = history[:-1]
        last = history[-1] if history else None
        chat = gen_model.start_chat(
            history=[
                {
                    "role": "model" if m["role"] == "assistant" else "user",
                    "parts": [{"text": m["content"]}],
                }
                for m in prior
            ]
        )
        prompt = (
            last["content"]
            if last and last.get("role") == "user"
            else "\n\n".join(m["content"] for m in history)
        )
        result = chat.send_message(prompt)
        return (result.text or "").strip() or "No se generó texto de respuesta."

    return await run_google_sync_with_backoff(_run_google, call_type="generate", attempts=4)
