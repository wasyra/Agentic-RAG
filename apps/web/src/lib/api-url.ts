/**
 * Base pública del backend FastAPI (`NEXT_PUBLIC_API_URL`).
 * Vacío: peticiones relativas a `/api/...` (útil detrás de un proxy que reenvíe al API).
 */
export function getApiBase(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
}

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBase();
  return base ? `${base}${p}` : p;
}
