import Link from "next/link";
import { SettingsForm } from "@/components/settings-form";

export default function SettingsPage() {
  return (
    <div className="min-h-dvh bg-[#08080f] px-4 py-10 text-zinc-100">
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 h-72 w-96 -translate-y-1/2 rounded-full bg-indigo-600/10 blur-3xl" />
      </div>

      <div className="mx-auto max-w-lg">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-indigo-400 mb-8"
        >
          <svg viewBox="0 0 24 24" fill="none" className="size-3.5" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Volver al chat
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-white">Configuración de IA</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">
            Elige <strong className="text-zinc-300">OpenAI o Google</strong>: una sola API key para chat y embeddings.
            Las credenciales quedan en el navegador; el modelo se persiste en <code className="rounded bg-white/[0.06] px-1 py-0.5 text-xs text-indigo-300">app-settings.json</code> vía FastAPI.
          </p>
        </div>

        <SettingsForm />
      </div>
    </div>
  );
}
