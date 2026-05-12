"use client";

import { useEffect, useState, startTransition } from "react";
import type { AiProviderId } from "@/lib/models";
import { apiUrl } from "@/lib/api-url";
import {
  aiRequestHeaders,
  clearStoredCredentials,
  getStoredAiProvider,
  getStoredApiKey,
  setStoredAiProvider,
  setStoredApiKey,
} from "@/lib/client-openai-key";

type ModelOpt = { id: string; label: string };
type SettingsPayload = {
  chatProvider: AiProviderId;
  chatModel: string;
  aiProviders: readonly { id: string; label: string }[];
  openaiChatModels: readonly ModelOpt[];
  googleChatModels: readonly ModelOpt[];
};

function modelsForProvider(p: AiProviderId, data: SettingsPayload): readonly ModelOpt[] {
  return p === "google" ? data.googleChatModels : data.openaiChatModels;
}

const PROVIDER_META: Record<string, { color: string; icon: React.ReactNode }> = {
  openai: {
    color: "text-emerald-300 bg-emerald-400/10 border-emerald-400/20",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073ZM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494ZM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646ZM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872Zm16.597 3.855-5.833-3.387 2.019-1.168a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.411-.663Zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66Zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681Zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5Z" />
      </svg>
    ),
  },
  google: {
    color: "text-blue-300 bg-blue-400/10 border-blue-400/20",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
        <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
      </svg>
    ),
  },
};

export function SettingsForm() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [chatProvider, setChatProvider] = useState<AiProviderId>("openai");
  const [chatModel, setChatModel] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const refreshKeyFlag = () => setHasKey(Boolean(getStoredApiKey()));

  useEffect(() => {
    startTransition(() => { refreshKeyFlag(); });
    startTransition(() => {
      void (async () => {
        try {
          const res = await fetch(apiUrl("/api/settings"));
          const j = (await res.json()) as SettingsPayload;
          setData(j);
          const fromLs = getStoredApiKey() ? getStoredAiProvider() : j.chatProvider;
          setChatProvider(fromLs);
          setChatModel(j.chatModel);
        } catch {
          setMessage({ text: "No se pudo cargar la configuración.", ok: false });
        } finally { setLoading(false); }
      })();
    });
  }, []);

  useEffect(() => {
    if (!data) return;
    const list = modelsForProvider(chatProvider, data);
    if (!list.some((m) => m.id === chatModel)) {
      startTransition(() => { setChatModel(list[0]?.id ?? chatModel); });
    }
  }, [chatProvider, data, chatModel]);

  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      setStoredAiProvider(chatProvider);
      if (apiKeyInput.trim()) setStoredApiKey(apiKeyInput);
      refreshKeyFlag();
      const res = await fetch(apiUrl("/api/settings"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...aiRequestHeaders() },
        body: JSON.stringify({ chatProvider, chatModel }),
      });
      const j = (await res.json()) as SettingsPayload & { error?: string };
      if (!res.ok) { setMessage({ text: j.error ?? "Error al guardar", ok: false }); return; }
      setData(j); setChatProvider(j.chatProvider); setStoredAiProvider(j.chatProvider);
      setChatModel(j.chatModel); setApiKeyInput("");
      setMessage({ text: "Guardado correctamente. La clave vive en localStorage y se envía en cada petición.", ok: true });
    } catch {
      setMessage({ text: "Error de red al guardar.", ok: false });
    } finally { setSaving(false); }
  };

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="size-4 animate-spin rounded-full border-2 border-zinc-700 border-t-indigo-400" />
          {loading ? "Cargando configuración…" : "Sin datos."}
        </div>
      </div>
    );
  }

  const modelOpts = modelsForProvider(chatProvider, data);
  const pMeta = PROVIDER_META[chatProvider];

  return (
    <div className="space-y-5">
      {/* Provider selector */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Proveedor de IA</p>
        <div className="grid grid-cols-2 gap-2">
          {data.aiProviders.map((p) => {
            const meta = PROVIDER_META[p.id] ?? { color: "text-zinc-400 bg-zinc-400/10 border-zinc-400/20", icon: null };
            const active = chatProvider === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => { setChatProvider(p.id as AiProviderId); setStoredAiProvider(p.id as AiProviderId); }}
                className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium transition-all duration-200 ${
                  active
                    ? `${meta.color} shadow-lg`
                    : "border-white/[0.06] bg-transparent text-zinc-500 hover:border-white/[0.12] hover:text-zinc-300"
                }`}
              >
                {meta.icon}
                {p.label.split(" ")[0]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Model selector */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Modelo de chat</p>
        <div className="space-y-2">
          {modelOpts.map((m) => {
            const active = chatModel === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setChatModel(m.id)}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-sm transition-all duration-200 ${
                  active
                    ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-200 shadow-lg shadow-indigo-500/5"
                    : "border-white/[0.06] bg-transparent text-zinc-400 hover:border-white/[0.12] hover:text-zinc-300"
                }`}
              >
                <span className="font-medium">{m.label}</span>
                {active && (
                  <span className="flex size-4 items-center justify-center rounded-full bg-indigo-500 text-white">
                    <svg viewBox="0 0 24 24" fill="none" className="size-2.5" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* API Key */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">API Key</p>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium border ${
            hasKey
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
              : "border-zinc-700 bg-zinc-800/50 text-zinc-500"
          }`}>
            <span className={`size-1.5 rounded-full ${hasKey ? "bg-emerald-400" : "bg-zinc-600"}`} />
            {hasKey ? "Configurada" : "Sin clave"}
          </span>
        </div>

        <input
          type="password"
          autoComplete="off"
          className="w-full rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3 text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
          placeholder={hasKey ? "•••••••• dejar vacío para no cambiar" : "Pegar clave de OpenAI o Google AI Studio"}
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
        />

        <div className="mt-3 rounded-xl border border-white/[0.04] bg-white/[0.01] px-3 py-2.5 text-[11px] leading-relaxed text-zinc-600">
          La clave se guarda en <span className="text-zinc-400">localStorage</span> del navegador y se envía en los headers{" "}
          <code className="rounded bg-white/[0.06] px-1 text-indigo-400">X-API-Key</code> y{" "}
          <code className="rounded bg-white/[0.06] px-1 text-indigo-400">X-AI-Provider</code> de cada petición.
        </div>

        {hasKey && (
          <button
            type="button"
            className="mt-3 flex items-center gap-1.5 text-xs text-zinc-600 transition-colors hover:text-rose-400"
            onClick={() => { clearStoredCredentials(); setApiKeyInput(""); refreshKeyFlag(); }}
          >
            <svg viewBox="0 0 24 24" fill="none" className="size-3.5" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
            Borrar credenciales del navegador
          </button>
        )}
      </div>

      {/* Save button */}
      <button
        type="button"
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-700 py-3 text-sm font-semibold text-white shadow-xl shadow-indigo-500/20 transition-all hover:from-indigo-500 hover:to-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={saving}
        onClick={() => void save()}
      >
        {saving && <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
        {saving ? "Guardando…" : "Guardar configuración"}
      </button>

      {/* Feedback message */}
      {message && (
        <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${
          message.ok
            ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
            : "border-rose-500/20 bg-rose-500/5 text-rose-300"
        }`}>
          {message.ok && (
            <svg viewBox="0 0 24 24" fill="none" className="mb-0.5 mr-1.5 inline size-4" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          )}
          {message.text}
        </div>
      )}
    </div>
  );
}
