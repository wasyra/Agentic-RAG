import Link from "next/link";
import { SettingsForm } from "@/components/settings-form";

export default function SettingsPage() {
  return (
    <div className="relative min-h-dvh px-4 pb-[max(3rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-zinc-100 sm:px-6 sm:py-16">
      <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
        <div className="absolute left-1/2 top-0 h-[28rem] w-[36rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-violet-600/[0.12] blur-3xl" />
        <div className="absolute bottom-0 right-0 h-80 w-80 translate-x-1/4 translate-y-1/4 rounded-full bg-cyan-500/[0.08] blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-lg">
        <Link
          href="/"
          className="mb-10 inline-flex items-center gap-2 text-xs font-medium text-zinc-500 transition-colors hover:text-violet-300"
        >
          <svg viewBox="0 0 24 24" fill="none" className="size-3.5" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Volver al chat
        </Link>

        <div className="mb-10">
          <h1 className="text-2xl font-semibold tracking-tight text-gradient-brand sm:text-3xl">Configuración de IA</h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-500">
            Elige <strong className="font-medium text-zinc-300">OpenAI o Google</strong>: una sola API key para chat y embeddings.
            Con el proxy activo la clave va en cookie httpOnly; si no, en localStorage. El modelo se guarda en{" "}
            <code className="rounded-md border border-white/[0.08] bg-white/[0.05] px-1.5 py-0.5 text-xs text-violet-300">
              app-settings.json
            </code>{" "}
            vía FastAPI.
          </p>
        </div>

        <div className="rounded-3xl border border-white/[0.08] bg-zinc-950/50 p-6 shadow-2xl shadow-violet-950/15 ring-1 ring-white/[0.04] backdrop-blur-xl sm:p-8">
          <SettingsForm />
        </div>
      </div>
    </div>
  );
}
