"use client";

import Link from "next/link";
import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage, Citation } from "@/lib/chat-types";
import { apiUrl } from "@/lib/api-url";
import { aiRequestHeaders } from "@/lib/client-openai-key";
import { useStudioKnowledgeBases } from "@/hooks/use-studio-knowledge-bases";
import { cn } from "@vetaui/foundations";
import {
  Alert,
  AlertDescription,
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  Kbd,
  ScrollArea,
  Skeleton,
  Textarea,
} from "@vetaui/atoms";
import { EmptyState } from "@vetaui/molecules";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@vetaui/organisms/composites";
import { Heading, HStack, Text, VStack } from "@vetaui/templates";
import { AgenticAurora } from "@/components/agentic/agentic-chrome";
import { AGENTIC_CTA_OUTLINE_CLASS } from "@/components/agentic/agentic-app-page-shell";
import { KnowledgeBaseDisplay } from "@/components/agentic/knowledge-base-display";
import {
  Bot,
  FileText,
  LibraryBig,
  Menu,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  Send,
  Settings,
  Sparkles,
  User,
} from "lucide-react";

const DESKTOP_SIDEBAR_LS_KEY = "agentic-studio-sidebar-collapsed";

type ConversationRow = { id: string; title: string | null; createdAt: string; updatedAt: string };

type ToastState = { message: string; tone: "error" | "info" } | null;

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

const CHAT_SUGGESTIONS = [
  "Resume los puntos clave de mis documentos.",
  "¿Qué restricciones o condiciones aparecen en los archivos?",
  "Enumera términos o definiciones importantes que encuentres.",
] as const;

// Group citations by document to avoid showing the same file N times
type GroupedCitation = {
  documentId: string;
  title: string;
  chunks: { chunkId: string; page: number | null; excerpt: string; globalIdx: number }[];
};

function groupCitations(citations: Citation[]): GroupedCitation[] {
  const map = new Map<string, GroupedCitation>();
  citations.forEach((c, idx) => {
    if (!map.has(c.documentId)) {
      map.set(c.documentId, { documentId: c.documentId, title: c.title, chunks: [] });
    }
    map.get(c.documentId)!.chunks.push({
      chunkId: c.chunkId,
      page: c.page,
      excerpt: c.excerpt,
      globalIdx: idx + 1,
    });
  });
  return Array.from(map.values());
}

// ── Accordion citation group (@vetaui/organisms) ───────────────────────────
function CitationGroup({ group, docNumber }: { group: GroupedCitation; docNumber: number }) {
  return (
    <AccordionItem value={group.documentId} className="border-none">
      <Card variant="interactive" className="overflow-hidden border-[var(--veta-border-soft)] bg-[var(--veta-bg-subtle)] shadow-md backdrop-blur-sm">
        <AccordionTrigger className="group min-h-12 h-auto justify-between gap-2 rounded-none px-3.5 py-3 text-[var(--veta-fg)] hover:bg-[var(--veta-bg-muted)] hover:no-underline sm:min-h-0 [&[data-state=open]]:bg-[var(--veta-bg-muted)]/80">
          <span className="flex min-w-0 flex-1 items-center gap-2.5 pr-2 text-left">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-[var(--veta-primary-subtle)] text-[10px] font-bold tabular-nums text-[var(--veta-primary)] ring-1 ring-[var(--veta-border-soft)]">
              {docNumber}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <FileText className="size-3.5 shrink-0 text-[var(--veta-primary)]" aria-hidden />
              <span className="truncate text-xs font-medium tracking-tight">{group.title}</span>
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="p-0 pb-0 [&>div]:pb-0 [&>div]:pt-0">
          <div className="divide-y divide-[var(--veta-border-soft)] border-t border-[var(--veta-border-soft)] bg-[color-mix(in_oklch,var(--veta-bg-subtle)_88%,transparent)]">
            {group.chunks.map((chunk) => (
              <div key={chunk.chunkId} className="px-3.5 py-3">
                {chunk.page != null && (
                  <Badge variant="info" emphasis="subtle" size="sm" className="mb-1.5">
                    pág. {chunk.page}
                  </Badge>
                )}
                <p className="text-[11px] leading-relaxed text-[var(--veta-fg-muted)] line-clamp-4">{chunk.excerpt}</p>
              </div>
            ))}
          </div>
        </AccordionContent>
      </Card>
    </AccordionItem>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export function ChatApp() {
  const { knowledgeBases, kbId, setKbId, loadingKb } = useStudioKnowledgeBases();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sources, setSources] = useState<Citation[]>([]);
  const [toast, setToast] = useState<ToastState>(null);
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);
  const [mobileSourcesOpen, setMobileSourcesOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => bottomRef.current?.scrollIntoView({ behavior: "smooth" });

  useEffect(() => { scrollToBottom(); }, [messages, sending, awaitingFirstToken]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const pushToast = useCallback((message: string, tone: "error" | "info" = "info") => {
    setToast({ message, tone });
  }, []);

  const loadConversations = useCallback(async (id: string) => {
    if (!id) {
      setConversations([]);
      return;
    }
    setLoadingConversations(true);
    try {
      const res = await fetch(
        apiUrl(`/api/conversations?knowledgeBaseId=${encodeURIComponent(id)}`),
        { credentials: "include" },
      );
      const data = (await res.json()) as { conversations: ConversationRow[] };
      setConversations(data.conversations ?? []);
    } catch {
      setConversations([]);
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  const openConversation = useCallback(async (cid: string) => {
    try {
      const res = await fetch(
        apiUrl(`/api/conversations/${encodeURIComponent(cid)}/messages`),
        { credentials: "include" },
      );
      const data = (await res.json()) as {
        messages: { id: string; role: string; content: string; citations?: Citation[] }[];
      };
      const mapped: ChatMessage[] = (data.messages ?? [])
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          citations: m.role === "assistant" ? m.citations : undefined,
        }));
      setConversationId(cid);
      setMessages(mapped);
      setSources([]);
    } catch {
      pushToast("No se pudo cargar la conversación.", "error");
    }
  }, [pushToast]);

  const newConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setSources([]);
  }, []);

  const startNewConversation = useCallback(() => {
    setMobileSidebarOpen(false);
    newConversation();
  }, [newConversation]);

  const openConversationFromSidebar = useCallback(
    (cid: string) => {
      setMobileSidebarOpen(false);
      void openConversation(cid);
    },
    [openConversation],
  );

  useEffect(() => {
    startTransition(() => {
      try {
        if (localStorage.getItem(DESKTOP_SIDEBAR_LS_KEY) === "1") {
          setDesktopSidebarCollapsed(true);
        }
      } catch {
        /* ignore */
      }
    });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DESKTOP_SIDEBAR_LS_KEY, desktopSidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [desktopSidebarCollapsed]);

  useEffect(() => {
    startTransition(() => {
      setConversationId(null);
      setMessages([]);
      setSources([]);
      void loadConversations(kbId);
    });
  }, [kbId, loadConversations]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  useEffect(() => {
    if (!mobileSourcesOpen && !mobileSidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (mobileSourcesOpen) setMobileSourcesOpen(false);
      else if (mobileSidebarOpen) setMobileSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileSourcesOpen, mobileSidebarOpen]);

  useEffect(() => {
    if (!mobileSourcesOpen && !mobileSidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileSourcesOpen, mobileSidebarOpen]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const userMsg: ChatMessage = { role: "user", content: text };
    setInput("");
    setMessages((m) => [...m, userMsg]);
    setSending(true);
    setSources([]);
    setAwaitingFirstToken(true);

    let buf = "";
    let assistantStarted = false;
    let fullAssistant = "";

    const applyDelta = (t: string) => {
      if (t) setAwaitingFirstToken(false);
      fullAssistant += t;
      if (!assistantStarted) {
        assistantStarted = true;
        setMessages((m) => [...m, { role: "assistant", content: fullAssistant }]);
      } else {
        setMessages((m) => {
          const n = [...m];
          const last = n[n.length - 1];
          if (last?.role === "assistant") {
            n[n.length - 1] = { ...last, content: fullAssistant };
          }
          return n;
        });
      }
    };

    const handleEvent = (obj: Record<string, unknown>) => {
      const typ = obj.type as string | undefined;
      if (typ === "meta") {
        const cid = obj.conversationId as string | undefined;
        if (cid) setConversationId(cid);
        return;
      }
      if (typ === "delta" && typeof obj.text === "string") {
        applyDelta(obj.text);
        return;
      }
      if (typ === "done") {
        setAwaitingFirstToken(false);
        const citations = (obj.citations as Citation[] | undefined) ?? [];
        const reply = (obj.reply as string | undefined) ?? fullAssistant;
        const cid = obj.conversationId as string | undefined;
        if (cid) setConversationId(cid);
        setSources(citations);
        setMessages((m) => {
          const n = [...m];
          const last = n[n.length - 1];
          if (last?.role === "assistant") {
            n[n.length - 1] = { ...last, content: reply, citations };
          } else {
            n.push({ role: "assistant", content: reply, citations });
          }
          return n;
        });
        void loadConversations(kbId);
        return;
      }
      if (typ === "error") {
        setAwaitingFirstToken(false);
        const msg = (obj.message as string | undefined) ?? "Error";
        const http = obj.httpStatus as number | undefined;
        const line = `${http ? `[${http}] ` : ""}${msg}`;
        setMessages((m) => {
          const n = [...m];
          const last = n[n.length - 1];
          if (assistantStarted && last?.role === "assistant") {
            n[n.length - 1] = { role: "assistant", content: line };
            return n;
          }
          return [...m, { role: "assistant", content: line }];
        });
      }
    };

    const drainBuf = () => {
      while (true) {
        const idx = buf.indexOf("\n\n");
        if (idx === -1) break;
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            handleEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
          } catch {
            /* ignore malformed chunk */
          }
        }
      }
    };

    try {
      const res = await fetch(apiUrl("/api/chat/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...aiRequestHeaders() },
        credentials: "include",
        body: JSON.stringify({
          messages: [...messages, userMsg].map(({ role, content }) => ({ role, content })),
          knowledgeBaseId: kbId || undefined,
          conversationId: conversationId ?? undefined,
        }),
      });

      if (!res.ok) {
        setAwaitingFirstToken(false);
        try {
          const err = (await res.json()) as { error?: string; detail?: string };
          const msg =
            err.error ??
            (typeof err.detail === "string" ? err.detail : "Error del servidor.");
          setMessages((m) => [...m, { role: "assistant", content: msg }]);
        } catch {
          setMessages((m) => [...m, { role: "assistant", content: "Error al contactar el servidor." }]);
        }
        return;
      }

      const ctype = res.headers.get("content-type") ?? "";
      if (!res.body || !ctype.includes("text/event-stream")) {
        setAwaitingFirstToken(false);
        setMessages((m) => [
          ...m,
          { role: "assistant", content: "Respuesta inesperada del servidor (no es SSE)." },
        ]);
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        drainBuf();
      }
      buf += dec.decode();
      drainBuf();
    } catch {
      setAwaitingFirstToken(false);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "No se pudo conectar. Revisa tu red o el servidor." },
      ]);
    } finally {
      setSending(false);
      setAwaitingFirstToken(false);
    }
  };

  const groupedSources = groupCitations(sources);
  const activeKbName = knowledgeBases.find((k) => k.id === kbId)?.name ?? null;
  const singleKbMode = knowledgeBases.length === 1;

  const sourcesPanelInner =
    groupedSources.length === 0 ? (
      <EmptyState
        className="mx-auto my-2 max-w-[17rem] border-[var(--veta-border-soft)] bg-[color-mix(in_oklch,var(--veta-surface-elevated)_75%,transparent)] py-8 shadow-sm"
        icon={<FileText className="text-[var(--veta-primary)]" aria-hidden />}
        title="Sin citas aún"
        description="Tras cada respuesta verás aquí los fragmentos citados del documento recuperado."
      />
    ) : (
      <Accordion
        type="multiple"
        defaultValue={groupedSources.map((g) => g.documentId)}
        className="space-y-2"
      >
        {groupedSources.map((group, i) => (
          <CitationGroup key={group.documentId} group={group} docNumber={i + 1} />
        ))}
      </Accordion>
    );

  return (
    <div className="relative isolate flex h-full min-h-0 w-full max-w-[100dvw] flex-1 flex-col overflow-hidden text-[var(--veta-fg)] md:flex-row md:items-stretch">
      <AgenticAurora />

      {toast && (
        <div
          className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] max-sm:px-2"
          style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
          role="status"
          aria-live="polite"
        >
          <Alert
            variant={toast.tone === "error" ? "danger" : "info"}
            className={cn(
              "pointer-events-auto flex max-w-md items-center gap-3 border shadow-2xl backdrop-blur-xl",
              toast.tone === "error" ? "pr-2" : "pr-2",
            )}
          >
            <AlertDescription className="flex-1 leading-snug">{toast.message}</AlertDescription>
            <Button type="button" variant="ghost" size="sm" className="agentic-tap shrink-0 text-sm" onClick={() => setToast(null)} aria-label="Cerrar aviso">
              Cerrar
            </Button>
          </Alert>
        </div>
      )}

      {mobileSidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-[84] bg-[var(--veta-bg-overlay)] backdrop-blur-md md:hidden"
          aria-label="Cerrar menú de biblioteca"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar (drawer en móvil, columna fija en md+; colapsable en web) ─ */}
      <aside
        className={cn(
          "agentic-glass-panel agentic-col-rail flex max-h-dvh shrink-0 flex-col overflow-hidden transition-[transform,width,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:h-full md:min-h-0 md:max-h-none md:flex-none",
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full",
          desktopSidebarCollapsed
            ? "md:w-0 md:min-w-0 md:max-w-0 md:border-transparent md:opacity-0 md:pointer-events-none md:shadow-none"
            : "md:w-[min(20.5rem,26vw)] md:max-w-none md:opacity-100",
          "fixed inset-y-0 left-0 z-[85] w-[min(22rem,calc(100dvw-1.5rem))] max-w-[min(22rem,calc(100dvw-1.5rem))] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-[0_24px_64px_-28px_color-mix(in_oklch,var(--veta-primary)_18%,transparent)] md:relative md:inset-auto md:z-auto md:translate-x-0 md:self-stretch md:py-0 md:pb-0 md:pt-0 md:shadow-none",
        )}
        aria-hidden={desktopSidebarCollapsed ? true : undefined}
      >
        <div className="flex h-full min-h-0 w-[min(22rem,calc(100dvw-1.5rem))] min-w-0 flex-col md:w-[min(20.5rem,26vw)]">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--veta-border)] px-4 py-3 md:hidden">
          <Text variant="small" weight="semibold" className="text-[var(--veta-fg)]">
            Biblioteca
          </Text>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="agentic-tap shrink-0 rounded-2xl text-sm"
            onClick={() => setMobileSidebarOpen(false)}
          >
            Cerrar
          </Button>
        </div>
        {/* Brand */}
        <div className="border-b border-[var(--veta-border)] px-5 py-5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="relative flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--veta-primary-subtle)] shadow-[inset_0_1px_0_color-mix(in_oklch,var(--veta-fg)_10%,transparent)] ring-1 ring-[var(--veta-border)]">
                <div className="flex size-full items-center justify-center rounded-[13px] bg-[color-mix(in_oklch,var(--veta-bg)_55%,transparent)]">
                  <Sparkles className="size-5 text-[var(--veta-primary)]" aria-hidden />
                </div>
              </div>
              <VStack gap={1} className="min-w-0 flex-1">
                <HStack gap={2} align="center" className="min-w-0">
                  <Heading as="h1" size="md" weight="semibold" className="truncate tracking-tight text-[var(--veta-fg)]">
                    Agentic RAG
                  </Heading>
                  <Badge variant="brand" emphasis="subtle" size="sm" className="shrink-0 tabular-nums">
                    Studio
                  </Badge>
                </HStack>
                <Text as="span" variant="caption" tone="muted" className="uppercase tracking-[0.2em]">
                  Postgres · pgvector
                </Text>
              </VStack>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="agentic-tap-icon hidden shrink-0 rounded-xl text-[var(--veta-fg-muted)] hover:bg-[var(--veta-bg-muted)] hover:text-[var(--veta-fg)] md:inline-flex"
              onClick={() => setDesktopSidebarCollapsed(true)}
              aria-label="Ocultar biblioteca"
            >
              <PanelLeftClose className="size-5" aria-hidden />
            </Button>
          </div>
        </div>

        {/* Conversaciones */}
        <div className="border-b border-[var(--veta-border)] px-4 py-4">
          <div className="mb-2.5 flex items-center gap-2">
            <Text
              variant="overline"
              tone="muted"
              weight="semibold"
              className="min-w-0 flex-1 truncate tracking-[0.18em]"
            >
              Conversaciones
            </Text>
            <Button
              type="button"
              variant="soft"
              size="md"
              className="agentic-tap h-auto min-h-10 shrink-0 rounded-2xl px-3 text-xs font-semibold sm:h-8 sm:min-h-0 sm:px-2.5 sm:text-[11px]"
              onClick={startNewConversation}
            >
              Nueva
            </Button>
          </div>
          <ScrollArea className="min-h-[9rem] max-h-[min(36vh,14rem)] pr-3 sm:h-40 sm:max-h-none">
            <div className="space-y-1.5">
            {loadingConversations ? (
              <div className="space-y-2 py-0.5" aria-busy="true" aria-label="Cargando conversaciones">
                <Skeleton className="h-10 w-full rounded-xl" shape="rounded" />
                <Skeleton className="h-10 w-full rounded-xl" shape="rounded" />
                <Skeleton className="h-10 w-4/5 rounded-xl" shape="rounded" />
              </div>
            ) : conversations.length === 0 ? (
              <EmptyState
                className="border-none bg-transparent px-2 py-4 shadow-none sm:p-3"
                icon={<MessageSquare className="text-[var(--veta-fg-muted)]" aria-hidden />}
                title="Sin historial"
                description="Las conversaciones guardadas aparecerán aquí."
              />
            ) : (
              conversations.map((c) => (
                <Button
                  key={c.id}
                  type="button"
                  variant={conversationId === c.id ? "secondary" : "ghost"}
                  fullWidth
                  className={cn(
                    "group h-auto min-h-11 flex-col items-stretch gap-1 px-3 py-2.5 text-left text-sm font-normal transition-all sm:min-h-0 sm:gap-0.5 sm:py-2 sm:text-[11px]",
                    conversationId === c.id
                      ? "border border-[var(--veta-primary)] shadow-sm"
                      : "text-[var(--veta-fg-muted)] hover:text-[var(--veta-fg)]",
                  )}
                  onClick={() => void openConversationFromSidebar(c.id)}
                >
                  <span className="truncate text-[13px] font-medium leading-snug tracking-tight text-[var(--veta-fg)] sm:text-[11px]">
                    {c.title || "Sin título"}
                  </span>
                  <span className="truncate text-xs text-[var(--veta-fg-muted)] group-hover:text-[var(--veta-fg-subtle)] sm:text-[10px]">
                    {formatShortDate(c.updatedAt)}
                  </span>
                </Button>
              ))
            )}
            </div>
          </ScrollArea>
        </div>

        {/* Base de conocimiento */}
        <div className="space-y-3 border-b border-[var(--veta-border)] px-4 py-4">
          {knowledgeBases.length !== 1 ? (
            <Text variant="overline" tone="muted" weight="semibold" className="tracking-[0.18em]">
              Base de conocimiento
            </Text>
          ) : null}
          <KnowledgeBaseDisplay
            knowledgeBases={knowledgeBases}
            value={kbId}
            onValueChange={setKbId}
            loading={loadingKb}
            instanceId="studio-sidebar"
            size="sidebar"
          />

          <div className="rounded-2xl border border-[var(--veta-border-soft)] bg-[color-mix(in_oklch,var(--veta-bg-subtle)_88%,transparent)] p-4 shadow-sm">
            <Text variant="overline" tone="muted" weight="semibold" className="mb-2 tracking-[0.18em]">
              Indexación
            </Text>
            <Text variant="caption" tone="muted" className="mb-4 block leading-relaxed">
              Sube y gestiona archivos en la vista dedicada (mismo estilo que Ajustes de IA).
            </Text>
            <Button
              variant="outline"
              fullWidth
              size="lg"
              className={`agentic-tap h-auto min-h-[3rem] gap-2.5 px-5 py-3 text-base text-[var(--veta-fg)] ${AGENTIC_CTA_OUTLINE_CLASS}`}
              asChild
            >
              <Link href={kbId ? `/indexar?kb=${encodeURIComponent(kbId)}` : "/indexar"} onClick={() => setMobileSidebarOpen(false)}>
                <LibraryBig className="size-5 shrink-0 text-[var(--veta-primary)]" aria-hidden />
                Abrir vista de indexación
              </Link>
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 shrink-0 px-4 pb-4 pt-2 md:min-h-[4rem]">
          <Text variant="caption" tone="muted" className="text-center leading-relaxed md:text-left">
            {singleKbMode ? (
              <>Los archivos viven en la vista de indexación; el chat usa siempre tu espacio personal.</>
            ) : (
              <>
                El chat usa la base elegida arriba. Los archivos se administran en la{" "}
                <Link className="font-medium text-[var(--veta-primary)] underline-offset-2 hover:underline" href={kbId ? `/indexar?kb=${encodeURIComponent(kbId)}` : "/indexar"}>
                  vista de indexación
                </Link>
                .
              </>
            )}
          </Text>
        </div>
        </div>
      </aside>

      {/* ── Main chat area ────────────────────────────────────────────────── */}
      <main className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="agentic-glass-panel flex shrink-0 flex-col gap-3 border-b border-[var(--veta-border-soft)] px-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5 sm:py-3.5 lg:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="agentic-tap-icon shrink-0 rounded-xl border-[var(--veta-border-soft)] md:hidden"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Abrir biblioteca: conversaciones, base e indexación"
            >
              <Menu className="size-5" aria-hidden />
            </Button>
            {desktopSidebarCollapsed && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="agentic-tap-icon hidden shrink-0 rounded-xl border-[var(--veta-border-soft)] md:inline-flex"
                onClick={() => setDesktopSidebarCollapsed(false)}
                aria-label="Mostrar biblioteca"
              >
                <PanelLeft className="size-5" aria-hidden />
              </Button>
            )}
            <Avatar className="size-9 shrink-0 rounded-xl ring-1 ring-[var(--veta-border-soft)] sm:size-10 sm:rounded-2xl">
              <AvatarFallback className="rounded-xl bg-[var(--veta-bg-muted)] text-[var(--veta-primary)] sm:rounded-2xl">
                <Bot className="size-[1.15rem] sm:size-5" aria-hidden />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <Heading
                as="h2"
                size="md"
                weight="semibold"
                className="truncate text-base leading-tight tracking-tight text-[var(--veta-fg)] sm:text-lg"
              >
                Asistente contextual
              </Heading>
              <Text variant="caption" tone="muted" className="mt-0.5 line-clamp-2 text-xs leading-snug sm:truncate sm:line-clamp-none">
                {singleKbMode && kbId ? (
                  <>Conocimiento personal · RAG listo para consultar</>
                ) : activeKbName ? (
                  <>
                    RAG activo · <span className="text-[var(--veta-fg-subtle)]">{activeKbName}</span>
                  </>
                ) : (
                  <>
                    <span className="hidden md:inline">Selecciona una base en el panel lateral.</span>
                    <span className="md:hidden">Menú → elige una base.</span>
                  </>
                )}
              </Text>
            </div>
          </div>
          <nav
            aria-label="Acciones del chat"
            className="flex w-full min-w-0 shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-2"
          >
            {sources.length > 0 && (
              <Button
                type="button"
                variant="soft"
                size="md"
                className="agentic-tap w-full min-h-11 shrink-0 rounded-2xl text-sm font-semibold sm:w-auto lg:hidden"
                onClick={() => setMobileSourcesOpen(true)}
              >
                Fuentes ({sources.length})
              </Button>
            )}
            <div className="agentic-header-actions w-full min-w-0 sm:w-auto sm:min-w-0">
            <Button
              type="button"
              variant="outline"
              size="md"
              className={cn(
                "agentic-tap shrink-0 min-h-11 rounded-2xl px-4 text-sm font-semibold",
                AGENTIC_CTA_OUTLINE_CLASS,
              )}
              onClick={startNewConversation}
            >
              <span className="sm:hidden">Nueva</span>
              <span className="hidden sm:inline">Nueva charla</span>
            </Button>
            <Button
              variant="outline"
              size="md"
              className={cn(
                "agentic-tap hidden shrink-0 min-h-11 rounded-2xl px-4 text-sm font-semibold sm:inline-flex",
                AGENTIC_CTA_OUTLINE_CLASS,
              )}
              asChild
            >
              <Link
                href={kbId ? `/indexar?kb=${encodeURIComponent(kbId)}` : "/indexar"}
                onClick={() => setMobileSidebarOpen(false)}
                className="inline-flex items-center justify-center gap-2"
              >
                <LibraryBig className="size-4 shrink-0 text-[var(--veta-primary)] sm:size-[1.05rem]" aria-hidden />
                Indexar archivos
              </Link>
            </Button>
            <Button
              variant="outline"
              size="md"
              className={cn("agentic-tap shrink-0 min-h-11 rounded-2xl px-4 text-sm font-semibold sm:hidden", AGENTIC_CTA_OUTLINE_CLASS)}
              asChild
            >
              <Link href={kbId ? `/indexar?kb=${encodeURIComponent(kbId)}` : "/indexar"} onClick={() => setMobileSidebarOpen(false)}>
                Indexar
              </Link>
            </Button>
            <Button
              variant="outline"
              size="md"
              className={cn(
                "agentic-tap hidden shrink-0 min-h-11 rounded-2xl px-4 text-sm font-semibold sm:inline-flex",
                AGENTIC_CTA_OUTLINE_CLASS,
              )}
              asChild
            >
              <Link href="/settings" onClick={() => setMobileSidebarOpen(false)} className="inline-flex items-center justify-center gap-2">
                <Settings className="size-4 shrink-0 text-[var(--veta-primary)] sm:size-[1.05rem]" aria-hidden />
                Ajustes IA
              </Link>
            </Button>
            <Button
              variant="outline"
              size="md"
              className={cn("agentic-tap shrink-0 min-h-11 rounded-2xl px-4 text-sm font-semibold sm:hidden", AGENTIC_CTA_OUTLINE_CLASS)}
              asChild
            >
              <Link href="/settings" onClick={() => setMobileSidebarOpen(false)}>
                Ajustes
              </Link>
            </Button>
            </div>
          </nav>
        </header>

        {/* Messages */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] py-5 sm:px-5 sm:py-8 lg:px-8">
          {messages.length === 0 ? (
            <div className="mx-auto w-full min-w-0 max-w-3xl py-8 sm:py-14">
              <div className="relative">
                <div
                  className="pointer-events-none absolute -left-6 -top-10 h-44 w-52 rounded-full opacity-90 blur-3xl sm:h-56 sm:w-64"
                  style={{
                    background:
                      "radial-gradient(circle, color-mix(in oklch, var(--veta-primary), transparent 72%) 0%, transparent 70%)",
                  }}
                  aria-hidden
                />
                <div
                  className="pointer-events-none absolute -bottom-6 right-0 h-40 w-40 rounded-full opacity-80 blur-3xl sm:h-48 sm:w-48"
                  style={{
                    background:
                      "radial-gradient(circle, color-mix(in oklch, var(--veta-accent), transparent 78%) 0%, transparent 72%)",
                  }}
                  aria-hidden
                />

                <VStack gap={6} className="relative min-w-0">
                  <div className="space-y-4">
                    <Text variant="overline" tone="muted" weight="semibold" className="tracking-[0.22em]">
                      Estudio
                    </Text>
                    <Heading
                      as="h2"
                      size="3xl"
                      weight="semibold"
                      className="text-balance text-[var(--veta-fg)] sm:text-4xl"
                    >
                      Pregunta con contexto real
                    </Heading>
                    <Text variant="lead" tone="muted" className="max-w-2xl text-pretty text-base leading-relaxed sm:text-lg">
                      Tus PDF y textos alimentan el RAG. Las citas verificables se agrupan en{" "}
                      <span className="font-medium text-[var(--veta-fg-subtle)]">Fuentes</span> (panel derecho en escritorio, botón en móvil).
                    </Text>
                    <HStack gap={3} className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap">
                      <Button
                        variant="outline"
                        size="lg"
                        asChild
                        className={cn("agentic-tap min-h-[3rem] w-full justify-center px-5 text-base sm:w-auto sm:justify-start", AGENTIC_CTA_OUTLINE_CLASS)}
                      >
                        <Link
                          href={kbId ? `/indexar?kb=${encodeURIComponent(kbId)}` : "/indexar"}
                          className="inline-flex items-center gap-2.5"
                        >
                          <LibraryBig className="size-5 text-[var(--veta-primary)]" aria-hidden />
                          Indexar archivos
                        </Link>
                      </Button>
                      <Button
                        variant="outline"
                        size="lg"
                        asChild
                        className={cn("agentic-tap min-h-[3rem] w-full justify-center px-5 text-base sm:w-auto sm:justify-start", AGENTIC_CTA_OUTLINE_CLASS)}
                      >
                        <Link href="/settings" className="inline-flex items-center gap-2.5">
                          <Settings className="size-5 text-[var(--veta-primary)]" aria-hidden />
                          Ajustes de IA
                        </Link>
                      </Button>
                    </HStack>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Card variant="elevated" className="agentic-glass-panel rounded-2xl border-[var(--veta-border-soft)] p-5 shadow-lg sm:rounded-3xl sm:p-6">
                      <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-[var(--veta-primary-subtle)] ring-1 ring-[var(--veta-border-soft)]">
                        <Sparkles className="size-5 text-[var(--veta-primary)]" aria-hidden />
                      </div>
                      <Text variant="overline" tone="muted" weight="semibold" className="mb-2 tracking-[0.18em]">
                        Paso 1
                      </Text>
                      <Heading as="h3" size="md" weight="semibold" className="mb-2 text-[var(--veta-fg)]">
                        Enriquece tu biblioteca
                      </Heading>
                      <Text variant="caption" tone="muted" className="leading-relaxed">
                        Sube materiales en la vista de indexación. El estado de cada archivo queda claro antes de chatear.
                      </Text>
                    </Card>
                    <Card variant="elevated" className="agentic-glass-panel rounded-2xl border-[var(--veta-border-soft)] p-5 shadow-lg sm:rounded-3xl sm:p-6">
                      <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-[var(--veta-accent-subtle)] ring-1 ring-[var(--veta-border-soft)]">
                        <Bot className="size-5 text-[var(--veta-accent)]" aria-hidden />
                      </div>
                      <Text variant="overline" tone="muted" weight="semibold" className="mb-2 tracking-[0.18em]">
                        Paso 2
                      </Text>
                      <Heading as="h3" size="md" weight="semibold" className="mb-2 text-[var(--veta-fg)]">
                        Conversa aquí
                      </Heading>
                      <Text variant="caption" tone="muted" className="leading-relaxed">
                        Escribe abajo: el modelo recupera fragmentos y puedes contrastar con las citas al final de cada respuesta.
                      </Text>
                    </Card>
                  </div>

                  {kbId ? (
                    <Card variant="elevated" className="agentic-glass-panel rounded-2xl border-[var(--veta-border-soft)] p-5 sm:rounded-3xl sm:p-6">
                      <Text variant="overline" tone="muted" weight="semibold" className="mb-4 tracking-[0.18em]">
                        Prueba con una sugerencia
                      </Text>
                      <div className="flex flex-col gap-2.5">
                        {CHAT_SUGGESTIONS.map((s) => (
                          <Button
                            key={s}
                            type="button"
                            variant="outline"
                            className={cn(
                              "agentic-tap h-auto min-h-[3rem] justify-start rounded-2xl px-4 py-3 text-left text-sm font-normal leading-snug sm:text-sm",
                              AGENTIC_CTA_OUTLINE_CLASS,
                            )}
                            onClick={() => {
                              setInput(s);
                              textareaRef.current?.focus();
                            }}
                          >
                            {s}
                          </Button>
                        ))}
                      </div>
                    </Card>
                  ) : (
                    <Alert variant="warning" className="rounded-2xl border-[var(--veta-border-soft)]">
                      <AlertDescription>
                        <p className="md:hidden">
                          Abre <span className="font-medium">Menú</span> y confirma la base de conocimiento (o ejecuta el seed si aún no hay bases).
                        </p>
                        <p className="hidden md:block">
                          Selecciona una base en la barra lateral para habilitar sugerencias y enviar mensajes.
                        </p>
                      </AlertDescription>
                    </Alert>
                  )}
                </VStack>
              </div>
            </div>
          ) : (
            <ul className="agentic-chat-column w-full space-y-6 sm:space-y-8">
              {messages.map((msg, i) => (
                <li
                  key={msg.id ?? `m-${i}`}
                  className={`flex min-w-0 gap-3 sm:gap-3.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                >
                  <Avatar
                    className={cn(
                      "size-9 shrink-0 rounded-xl ring-1 ring-[var(--veta-border-soft)]",
                      msg.role === "user" ? "bg-[var(--veta-primary)]" : "bg-[var(--veta-bg-muted)]",
                    )}
                  >
                    <AvatarFallback
                      className={cn(
                        "rounded-xl text-[0.65rem] font-semibold uppercase",
                        msg.role === "user"
                          ? "bg-transparent text-[var(--veta-primary-fg)]"
                          : "bg-transparent text-[var(--veta-primary)]",
                      )}
                    >
                      {msg.role === "user" ? <User className="size-4" aria-hidden /> : <Bot className="size-4" aria-hidden />}
                    </AvatarFallback>
                  </Avatar>

                  {/* Bubble */}
                  <div
                    className={cn(
                      "min-w-0 max-w-[min(calc(100dvw-5.5rem),42rem)] break-words rounded-2xl px-3 py-2.5 text-sm leading-relaxed sm:max-w-[80%] sm:px-4 sm:py-3.5",
                      msg.role === "user" &&
                        "agentic-msg-user rounded-tr-sm text-[var(--veta-primary-fg)] ring-1 ring-[var(--veta-border-soft)]",
                      msg.role === "assistant" &&
                        (msg.content.startsWith("Error del modelo:") || msg.content.startsWith("⚠️") || /^\[\d{3}\]/.test(msg.content))
                        ? "rounded-tl-sm border border-[var(--veta-warning)] bg-[var(--veta-warning-subtle)] text-[var(--veta-warning-fg)] shadow-md"
                        : msg.role === "assistant" &&
                            "agentic-msg-assistant rounded-tl-sm border border-[var(--veta-border-soft)] bg-[var(--veta-bg-muted)] text-[var(--veta-fg)] backdrop-blur-md",
                    )}
                  >
                    {msg.role === "assistant" ? (
                      msg.content.startsWith("Error del modelo:") || msg.content.startsWith("⚠️") || /^\[\d{3}\]/.test(msg.content) ? (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      ) : (
                        <div className="prose prose-invert prose-sm max-w-none break-words prose-p:my-1.5 prose-headings:my-2 prose-pre:max-w-full prose-pre:overflow-x-auto prose-code:text-[var(--veta-primary)] prose-pre:border prose-pre:border-[var(--veta-border)]">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      )
                    ) : (
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed sm:text-sm">{msg.content}</p>
                    )}
                  </div>
                </li>
              ))}

              {/* Thinking indicator */}
              {sending && awaitingFirstToken && (
                <li className="flex min-w-0 gap-3 sm:gap-3.5">
                  <Avatar className="size-9 shrink-0 rounded-xl ring-1 ring-[var(--veta-border-soft)]">
                    <AvatarFallback className="rounded-xl bg-[var(--veta-bg-muted)] text-[var(--veta-primary)]">
                      <Bot className="size-4" aria-hidden />
                    </AvatarFallback>
                  </Avatar>
                  <Card variant="outline" className="agentic-msg-assistant flex items-center gap-3 rounded-2xl rounded-tl-sm border-[var(--veta-border-soft)] px-4 py-3.5">
                    <span className="inline-flex items-end gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--veta-primary)] [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--veta-accent)] [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--veta-info)]" />
                    </span>
                    <Text variant="small" weight="medium" tone="muted">
                      Generando respuesta…
                    </Text>
                  </Card>
                </li>
              )}
              <div ref={bottomRef} />
            </ul>
          )}
        </div>

        {/* Input */}
        <footer
          className="agentic-glass-panel shrink-0 border-t border-[var(--veta-border-soft)] px-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-5 lg:px-8"
        >
          <div className="agentic-chat-column w-full">
            <div className="agentic-composer flex flex-col gap-2 p-2 sm:flex-row sm:items-end sm:gap-3 sm:p-1.5">
              <Textarea
                ref={textareaRef}
                appearance="ghost"
                resize="none"
                size="sm"
                className="agentic-chat-input !min-h-[2.75rem] max-h-40 w-full min-w-0 flex-1 border-0 bg-transparent px-3 py-2.5 text-base shadow-none !resize-none focus-visible:ring-0 sm:!min-h-10 sm:text-sm"
                rows={1}
                placeholder={kbId ? "Escribe tu pregunta…" : "Elige una base de conocimiento"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                disabled={!kbId || sending}
                aria-label="Mensaje para el asistente"
              />
              <Button
                type="button"
                variant="elevated"
                className="agentic-btn-send min-h-[3rem] w-full min-w-0 gap-2 rounded-2xl px-6 text-base font-semibold tracking-tight sm:min-h-[2.75rem] sm:w-auto sm:px-5 sm:text-sm"
                onClick={() => void send()}
                disabled={!kbId || sending || !input.trim()}
                aria-busy={sending}
                aria-label="Enviar mensaje"
              >
                <Send className="size-4" aria-hidden />
                Enviar
              </Button>
            </div>
            <HStack gap={2} justify="center" className="mt-2.5 flex-wrap">
              <Text variant="caption" tone="muted">
                <Kbd className="px-1.5">Enter</Kbd> envía
              </Text>
              <Text variant="caption" tone="muted">
                <Kbd className="px-1.5">Shift</Kbd> + <Kbd className="px-1.5">Enter</Kbd> nueva línea
              </Text>
            </HStack>
          </div>
        </footer>
      </main>

      {/* ── Sources panel ─────────────────────────────────────────────────── */}
      <section className="agentic-glass-panel agentic-col-rail-right hidden min-h-0 w-[min(20rem,28vw)] min-w-0 max-w-[24rem] shrink-0 flex-col overflow-hidden lg:flex xl:w-[20rem]">
        <div className="border-b border-[var(--veta-border)] px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <Text variant="overline" tone="muted" weight="semibold" className="tracking-[0.18em]">
              Fuentes citadas
            </Text>
            {sources.length > 0 && (
              <Badge variant="brand" emphasis="subtle" size="sm">
                {groupedSources.length} {groupedSources.length === 1 ? "doc" : "docs"}
              </Badge>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3.5">{sourcesPanelInner}</div>
      </section>

      {mobileSourcesOpen && (
        <div className="fixed inset-0 z-[90] lg:hidden" role="dialog" aria-modal="true" aria-labelledby="mobile-sources-title">
          <button
            type="button"
            className="absolute inset-0 bg-[var(--veta-bg-overlay)] backdrop-blur-md"
            onClick={() => setMobileSourcesOpen(false)}
            aria-label="Cerrar panel de fuentes"
          />
          <div className="absolute bottom-0 left-0 right-0 flex max-h-[min(88dvh,560px)] flex-col overflow-hidden rounded-t-3xl border border-[var(--veta-border)] bg-[var(--veta-bg)] pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur-2xl">
            <div className="flex justify-center pt-2">
              <span className="h-1 w-10 rounded-full bg-[var(--veta-border-strong)]" aria-hidden />
            </div>
            <div className="flex items-center justify-between border-b border-[var(--veta-border)] px-4 py-3.5">
              <Heading as="h2" id="mobile-sources-title" size="md" weight="semibold" className="text-[var(--veta-fg)]">
                Fuentes citadas
              </Heading>
              <Button type="button" variant="outline" size="sm" className="agentic-tap shrink-0 rounded-2xl text-sm" onClick={() => setMobileSourcesOpen(false)}>
                Cerrar
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3.5">{sourcesPanelInner}</div>
          </div>
        </div>
      )}
    </div>
  );
}
