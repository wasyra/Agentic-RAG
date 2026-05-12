/**
 * Un solo proveedor (openai | google) y una sola API key en localStorage.
 * Cabeceras: `X-AI-Provider`, `X-API-Key`.
 */
import type { AiProviderId } from "@/lib/models";
import { DEFAULT_AI_PROVIDER } from "@/lib/models";

const LS_PROVIDER = "rag_kb_ai_provider";
const LS_API_KEY = "rag_kb_api_key";

export function getStoredAiProvider(): AiProviderId {
  if (typeof window === "undefined") return DEFAULT_AI_PROVIDER;
  const p = window.localStorage.getItem(LS_PROVIDER)?.trim().toLowerCase();
  return p === "google" ? "google" : "openai";
}

export function setStoredAiProvider(provider: AiProviderId) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_PROVIDER, provider);
}

export function getStoredApiKey(): string | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(LS_API_KEY)?.trim();
  return v && v.length > 0 ? v : null;
}

export function setStoredApiKey(apiKey: string) {
  if (typeof window === "undefined") return;
  const t = apiKey.trim();
  if (t) window.localStorage.setItem(LS_API_KEY, t);
  else window.localStorage.removeItem(LS_API_KEY);
}

export function clearStoredCredentials() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LS_API_KEY);
  window.localStorage.removeItem(LS_PROVIDER);
}

export function aiRequestHeaders(): Record<string, string> {
  const key = getStoredApiKey();
  const provider = getStoredAiProvider();
  if (!key) return {};
  return {
    "X-AI-Provider": provider,
    "X-API-Key": key,
  };
}
