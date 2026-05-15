"use client";

import { useEffect, useMemo, useState, startTransition } from "react";
import type { AiProviderId } from "@/lib/models";
import { apiUrl, ragProxyEnabled } from "@/lib/api-url";
import {
  aiRequestHeaders,
  clearStoredCredentials,
  getStoredAiProvider,
  getStoredApiKey,
  setStoredAiProvider,
  setStoredApiKey,
} from "@/lib/client-openai-key";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Code,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
} from "@vetaui/atoms";
import { FormField } from "@vetaui/molecules";
import { CheckCircle2, Trash2 } from "lucide-react";

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

const PROVIDER_ICON: Record<string, React.ReactNode> = {
  openai: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4 shrink-0" aria-hidden>
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073ZM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494ZM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646ZM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872Zm16.597 3.855-5.833-3.387 2.019-1.168a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.411-.663Zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66Zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681Zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5Z" />
    </svg>
  ),
  google: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4 shrink-0" aria-hidden>
      <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
    </svg>
  ),
};

export function SettingsForm() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [chatProvider, setChatProvider] = useState<AiProviderId>("openai");
  const [chatModel, setChatModel] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [lsKeyNonce, setLsKeyNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [proxySecretsOk, setProxySecretsOk] = useState(false);
  const [cookieSession, setCookieSession] = useState(false);

  useEffect(() => {
    startTransition(() => {
      void (async () => {
        try {
          const sres = await fetch("/api/ai-session", { credentials: "include" });
          const sj = (await sres.json()) as { proxySecretsOk?: boolean; cookieValid?: boolean };
          setProxySecretsOk(Boolean(sj.proxySecretsOk));
          setCookieSession(Boolean(sj.cookieValid));
        } catch {
          setProxySecretsOk(false);
          setCookieSession(false);
        }
      })();
    });
  }, []);

  const hasKey = useMemo(() => {
    void lsKeyNonce;
    if (ragProxyEnabled()) return cookieSession;
    return Boolean(getStoredApiKey());
  }, [cookieSession, lsKeyNonce]);

  useEffect(() => {
    startTransition(() => {
      void (async () => {
        try {
          const res = await fetch(apiUrl("/api/settings"), { credentials: "include" });
          const j = (await res.json()) as SettingsPayload;
          setData(j);
          const fromLs = getStoredApiKey() ? getStoredAiProvider() : j.chatProvider;
          setChatProvider(fromLs);
          setChatModel(j.chatModel);
        } catch {
          setMessage({ text: "No se pudo cargar la configuración.", ok: false });
        } finally {
          setLoading(false);
        }
      })();
    });
  }, []);

  useEffect(() => {
    if (!data) return;
    const list = modelsForProvider(chatProvider, data);
    if (!list.some((m) => m.id === chatModel)) {
      startTransition(() => {
        setChatModel(list[0]?.id ?? chatModel);
      });
    }
  }, [chatProvider, data, chatModel]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      setStoredAiProvider(chatProvider);
      const useProxy = ragProxyEnabled();

      if (useProxy) {
        if (!proxySecretsOk) {
          setMessage({
            text: "Define AI_SESSION_SECRET (mín. 16 caracteres) en el servidor Next para guardar la clave de forma segura.",
            ok: false,
          });
          return;
        }
        if (apiKeyInput.trim()) {
          const sres = await fetch("/api/ai-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ provider: chatProvider, apiKey: apiKeyInput.trim() }),
          });
          const sj = (await sres.json()) as { error?: string };
          if (!sres.ok) {
            setMessage({ text: sj.error ?? "No se pudo crear la sesión segura.", ok: false });
            return;
          }
          clearStoredCredentials();
          setCookieSession(true);
        }
      } else if (apiKeyInput.trim()) {
        setStoredApiKey(apiKeyInput);
        setLsKeyNonce((n) => n + 1);
      }

      const res = await fetch(apiUrl("/api/settings"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...aiRequestHeaders() },
        credentials: "include",
        body: JSON.stringify({ chatProvider, chatModel }),
      });
      const j = (await res.json()) as SettingsPayload & { error?: string };
      if (!res.ok) {
        setMessage({ text: j.error ?? "Error al guardar", ok: false });
        return;
      }
      setData(j);
      setChatProvider(j.chatProvider);
      setStoredAiProvider(j.chatProvider);
      setChatModel(j.chatModel);
      setApiKeyInput("");
      setMessage({
        text: useProxy
          ? "Guardado. La API key queda en cookie httpOnly en el servidor Next; no está en localStorage."
          : "Guardado. La clave está en localStorage del navegador y se envía en cabeceras hacia el API.",
        ok: true,
      });
    } catch {
      setMessage({ text: "Error de red al guardar.", ok: false });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3 text-[var(--veta-fg-muted)]">
          <Spinner size="md" />
          <span className="text-sm">{loading ? "Cargando configuración…" : "Sin datos."}</span>
        </div>
      </div>
    );
  }

  const modelOpts = modelsForProvider(chatProvider, data);

  return (
    <div className="flex w-full min-w-0 touch-manipulation flex-col gap-5 sm:gap-6">
      <Card variant="elevated" className="agentic-glass-panel rounded-2xl border-[var(--veta-border-soft)] sm:rounded-3xl">
        <CardHeader className="space-y-1 px-4 pt-5 sm:px-6 sm:pt-6">
          <CardTitle className="text-sm font-medium text-[var(--veta-fg)]">Proveedor de IA</CardTitle>
          <CardDescription className="text-xs text-[var(--veta-fg-muted)]">
            Motor que genera las respuestas y embeddings.
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 px-4 pb-5 pt-0 sm:px-6 sm:pb-6">
          <ToggleGroup
            type="single"
            className="grid w-full grid-cols-1 gap-2 min-[360px]:grid-cols-2"
            value={chatProvider}
            onValueChange={(v) => {
              if (!v) return;
              const id = v as AiProviderId;
              setChatProvider(id);
              setStoredAiProvider(id);
            }}
          >
            {data.aiProviders.map((p) => (
              <ToggleGroupItem
                key={p.id}
                value={p.id}
                variant="outline"
                className="h-auto min-h-12 gap-2.5 rounded-2xl px-4 py-3.5 text-sm data-[state=on]:border-[var(--veta-primary)] data-[state=on]:bg-[var(--veta-primary-subtle)] data-[state=on]:shadow-md min-[400px]:min-h-0 min-[400px]:py-3"
              >
                {PROVIDER_ICON[p.id] ?? null}
                <span className="truncate text-sm">{p.label.split(" ")[0]}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardContent>
      </Card>

      <Card variant="elevated" className="agentic-glass-panel rounded-2xl border-[var(--veta-border-soft)] sm:rounded-3xl">
        <CardHeader className="space-y-1 px-4 pt-5 sm:px-6 sm:pt-6">
          <CardTitle className="text-sm font-medium text-[var(--veta-fg)]">Modelo de chat</CardTitle>
          <CardDescription className="text-xs text-[var(--veta-fg-muted)]">
            Elige el modelo para este proveedor (lista nativa, adaptable a móvil y escritorio).
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-2 px-4 pb-5 pt-0 sm:px-6 sm:pb-6">
          <Select value={chatModel} onValueChange={(v) => setChatModel(v)}>
            <SelectTrigger
              className="min-h-12 w-full min-w-0 rounded-2xl px-4 py-3 text-left text-sm shadow-sm sm:min-h-11 [&>span]:line-clamp-2 [&>span]:min-w-0 [&>span]:text-pretty [&>span]:text-[var(--veta-fg)]"
              aria-label="Modelo de chat"
            >
              <SelectValue placeholder="Selecciona un modelo" />
            </SelectTrigger>
            <SelectContent
              position="item-aligned"
              className="z-[200] max-h-[min(55vh,24rem)] w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl shadow-2xl"
            >
              {modelOpts.map((m) => (
                <SelectItem key={m.id} value={m.id} className="cursor-pointer rounded-xl py-2.5 text-sm">
                  <span className="break-words [overflow-wrap:anywhere]">{m.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-[var(--veta-fg-muted)]">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[var(--veta-primary)]" aria-hidden />
            <span>
              Modelo activo: <span className="font-medium text-[var(--veta-fg)]">{modelOpts.find((x) => x.id === chatModel)?.label ?? chatModel}</span>
            </span>
          </p>
        </CardContent>
      </Card>

      <Card variant="elevated" className="agentic-glass-panel overflow-hidden rounded-2xl border-[var(--veta-border-soft)] sm:rounded-3xl">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 px-4 pt-5 sm:px-6 sm:pt-6">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-sm font-medium text-[var(--veta-fg)]">Credenciales</CardTitle>
            <CardDescription className="text-xs text-[var(--veta-fg-muted)]">API key y estado de la sesión.</CardDescription>
          </div>
          <Badge variant={hasKey ? "success" : "neutral"} emphasis="subtle" size="sm" className="shrink-0">
            {hasKey ? "Configurada" : "Sin clave"}
          </Badge>
        </CardHeader>
        <CardContent className="min-w-0 space-y-3 px-4 pb-1 pt-0 sm:px-6">
          <FormField id="provider-api-key" label="Clave API">
            <Input
              type="password"
              autoComplete="off"
              appearance="filled"
              size="lg"
              className="w-full min-w-0 rounded-2xl"
              placeholder={hasKey ? "•••••••• dejar vacío para no cambiar" : "Pegar clave de OpenAI o Google AI Studio"}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
            />
          </FormField>
          <div className="rounded-2xl border border-[var(--veta-border-soft)] bg-[var(--veta-bg-subtle)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--veta-fg-muted)] sm:px-4">
            {ragProxyEnabled() ? (
              <>
                Con el proxy activo, la clave se guarda en una{" "}
                <span className="font-medium text-[var(--veta-fg)]">cookie httpOnly</span>{" "}
                cifrada en el servidor Next (requiere <Code inline>AI_SESSION_SECRET</Code>). El cliente no puede leerla
                desde JavaScript.
              </>
            ) : (
              <>
                La clave se guarda en{" "}
                <span className="font-medium text-[var(--veta-fg)]">localStorage</span>{" "}
                del navegador y se envía en los headers <Code inline>X-API-Key</Code> y <Code inline>X-AI-Provider</Code> de
                cada petición.
              </>
            )}
          </div>

          {hasKey && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="agentic-tap h-auto min-h-11 w-full justify-start gap-1.5 px-2 text-sm text-[var(--veta-fg-muted)] hover:text-[var(--veta-danger)] sm:min-h-0"
              onClick={() => {
                if (ragProxyEnabled()) {
                  void fetch("/api/ai-session", { method: "DELETE", credentials: "include" }).then(() =>
                    setCookieSession(false),
                  );
                }
                clearStoredCredentials();
                setApiKeyInput("");
                setLsKeyNonce((n) => n + 1);
              }}
            >
              <Trash2 className="size-3.5" aria-hidden />
              Borrar credenciales del navegador
            </Button>
          )}
        </CardContent>
        <CardFooter className="border-t border-[var(--veta-border)] bg-[var(--veta-bg-subtle)]/50 px-4 pb-5 pt-5 sm:px-6">
          <Button
            type="button"
            variant="elevated"
            size="lg"
            fullWidth
            disabled={saving}
            onClick={() => void save()}
            className="agentic-btn-send gap-2.5 rounded-2xl px-6 py-3.5 text-base font-semibold min-h-[3.25rem] sm:min-h-[3.5rem]"
          >
            {saving ? <Spinner size="sm" tone="current" className="opacity-90" /> : null}
            {saving ? "Guardando…" : "Guardar configuración"}
          </Button>
        </CardFooter>
      </Card>

      {message && (
        <Alert variant={message.ok ? "success" : "danger"}>
          <AlertDescription>
            {message.ok && (
              <span className="mb-1 flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                Listo
              </span>
            )}
            <span className="block leading-relaxed">{message.text}</span>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
