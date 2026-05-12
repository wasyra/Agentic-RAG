/**
 * Base pública del backend FastAPI (`NEXT_PUBLIC_API_URL`).
 * Con `NEXT_PUBLIC_USE_RAG_PROXY=true`, el navegador llama al BFF de Next (`/api/rag-proxy/...`)
 * y el servidor inyecta la API key desde cookie httpOnly.
 */
export function ragProxyEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_RAG_PROXY === "true";
}

export function getApiBase(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
}

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (typeof window !== "undefined" && ragProxyEnabled()) {
    if (p.startsWith("/api/")) return `/api/rag-proxy${p}`;
    return p;
  }
  const base = getApiBase();
  return base ? `${base}${p}` : p;
}
