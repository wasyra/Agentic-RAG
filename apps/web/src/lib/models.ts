/**
 * Proveedor único: misma clave para chat y embeddings.
 * (Anthropic no expone embeddings públicos alineados con un solo flujo RAG.)
 */
export const AI_PROVIDERS = [
  { id: "openai", label: "OpenAI (GPT + embeddings)" },
  { id: "google", label: "Google (Gemini + embeddings)" },
] as const;

export type AiProviderId = (typeof AI_PROVIDERS)[number]["id"];

export const DEFAULT_AI_PROVIDER: AiProviderId = "openai";

const PROVIDER_SET = new Set<string>(AI_PROVIDERS.map((p) => p.id));

export function isAllowedAiProvider(id: string): id is AiProviderId {
  return PROVIDER_SET.has(id);
}

/** @deprecated usar AI_PROVIDERS */
export const CHAT_PROVIDERS = AI_PROVIDERS;

/** @deprecated usar AiProviderId */
export type ChatProviderId = AiProviderId;

export const OPENAI_CHAT_MODELS = [
  { id: "gpt-4o-mini", label: "GPT-4o mini (rápido / económico)" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
  { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  { id: "gpt-4.1", label: "GPT-4.1" },
] as const;

export const GOOGLE_CHAT_MODELS = [
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash (recomendado / estable)" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
] as const;

/** IDs antiguos (p. ej. app-settings) → equivalentes actuales en la API. */
const LEGACY_GOOGLE_CHAT_MODEL: Record<string, string> = {
  "gemini-1.5-flash": "gemini-2.5-flash",
  "gemini-1.5-flash-8b": "gemini-2.5-flash",
  "gemini-1.5-flash-latest": "gemini-2.5-flash",
  "gemini-1.5-pro": "gemini-2.5-pro",
  "gemini-1.5-pro-latest": "gemini-2.5-pro",
  "gemini-pro": "gemini-2.5-flash",
};

export function normalizeGoogleChatModelId(model: string): string {
  let m = model.trim();
  if (m.startsWith("models/")) m = m.slice("models/".length);
  return LEGACY_GOOGLE_CHAT_MODEL[m] ?? m;
}

export const CHAT_MODELS = OPENAI_CHAT_MODELS;

export type OpenAiChatModelId = (typeof OPENAI_CHAT_MODELS)[number]["id"];
export type GoogleChatModelId = (typeof GOOGLE_CHAT_MODELS)[number]["id"];

export const DEFAULT_OPENAI_CHAT_MODEL: OpenAiChatModelId = "gpt-4o-mini";
export const DEFAULT_GOOGLE_CHAT_MODEL: GoogleChatModelId = "gemini-2.0-flash";

const OPENAI_SET = new Set<string>(OPENAI_CHAT_MODELS.map((m) => m.id));
const GOOGLE_SET = new Set<string>(GOOGLE_CHAT_MODELS.map((m) => m.id));

export function isAllowedChatModelForProvider(
  provider: AiProviderId,
  model: string,
): boolean {
  if (provider === "openai") return OPENAI_SET.has(model);
  return GOOGLE_SET.has(normalizeGoogleChatModelId(model));
}

export function defaultChatModelForProvider(provider: AiProviderId): string {
  return provider === "google"
    ? DEFAULT_GOOGLE_CHAT_MODEL
    : DEFAULT_OPENAI_CHAT_MODEL;
}

/** En archivo de ajustes usamos `chatProvider` por compatibilidad. */
export function resolveAiProvider(
  file?: { chatProvider?: string } | null,
): AiProviderId {
  const p = file?.chatProvider?.trim().toLowerCase();
  if (p === "google") return "google";
  if (p === "anthropic") return "openai";
  return DEFAULT_AI_PROVIDER;
}

export function resolveChatModelForProvider(
  provider: AiProviderId,
  file?: { chatModel?: string } | null,
): string {
  let m = file?.chatModel?.trim();
  if (m === "gemini-2.0-flash-lite") m = "gemini-2.0-flash";
  if (provider === "google" && m) m = normalizeGoogleChatModelId(m);
  if (m && isAllowedChatModelForProvider(provider, m)) return m;
  return defaultChatModelForProvider(provider);
}

/** @deprecated */
export const DEFAULT_CHAT_PROVIDER = DEFAULT_AI_PROVIDER;
export function isAllowedChatProvider(id: string): id is AiProviderId {
  return isAllowedAiProvider(id);
}
export function resolveChatProvider(
  file?: { chatProvider?: string } | null,
): AiProviderId {
  return resolveAiProvider(file);
}
