import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, "rag-ai-session-v1", 32);
}

export type AiSessionPayload = { provider: string; apiKey: string };

export function sealAiSession(secret: string, payload: AiSessionPayload): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.from(
    JSON.stringify({ provider: payload.provider, apiKey: payload.apiKey }),
    "utf8",
  );
  const enc = Buffer.concat([cipher.update(body), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function openAiSession(secret: string, sealed: string): AiSessionPayload | null {
  try {
    const buf = Buffer.from(sealed, "base64url");
    if (buf.length < IV_LEN + TAG_LEN + 1) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const key = deriveKey(secret);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
    const j = JSON.parse(plain) as { provider?: string; apiKey?: string };
    const apiKey = (j.apiKey ?? "").trim();
    const provider = (j.provider ?? "openai").trim().toLowerCase();
    if (!apiKey) return null;
    return { provider: provider === "google" ? "google" : "openai", apiKey };
  } catch {
    return null;
  }
}
