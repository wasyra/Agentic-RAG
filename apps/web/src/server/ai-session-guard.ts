/**
 * Valores de ejemplo que no deben usarse en producción con el proxy de sesión IA.
 */
const NORMALIZED_FORBIDDEN = new Set(
  ["dev_change_me_min_16_chars_please", "cambia_esto_minimo_16_caracteres"].map((s) =>
    s.toLowerCase(),
  ),
);

function isTrivialSecret(secret: string): boolean {
  const t = secret.trim().toLowerCase();
  if (NORMALIZED_FORBIDDEN.has(t)) return true;
  if (t.includes("change_me")) return true;
  if (t.includes("cambia_esto")) return true;
  if (t === "passwordpasswordpassword") return true;
  return false;
}

/** Durante `next build` no exigimos el secreto (suele inyectarse solo en runtime). */
function isNextProductionBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/** Mensaje de error si la configuración es inaceptable en producción; null si OK o no aplica. */
export function getProductionAiSessionSecretError(): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  if (process.env.NEXT_PUBLIC_USE_RAG_PROXY !== "true") return null;
  if (isNextProductionBuildPhase()) return null;

  const secret = process.env.AI_SESSION_SECRET?.trim();
  if (!secret || secret.length < 16) {
    return "AI_SESSION_SECRET debe estar definido (mín. 16 caracteres) cuando NEXT_PUBLIC_USE_RAG_PROXY=true en producción.";
  }
  if (isTrivialSecret(secret)) {
    return "AI_SESSION_SECRET usa un valor de ejemplo o demasiado débil. Genera un secreto aleatorio largo y único para producción.";
  }
  return null;
}

/**
 * Falla el arranque del servidor Next en producción si el secreto de cookie IA es inseguro.
 */
export function assertProductionAiSessionSecret(): void {
  const err = getProductionAiSessionSecretError();
  if (err) throw new Error(err);
}
