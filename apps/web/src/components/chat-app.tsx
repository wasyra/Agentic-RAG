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

type KnowledgeBaseRow = { id: string; name: string; createdAt: string };
type ConversationRow = { id: string; title: string | null; createdAt: string; updatedAt: string };
type DocumentRow = {
  id: string;
  title: string;
  fileName: string;
  status: string;
  statusMessage: string | null;
  createdAt: string;
};
type UploadPhase = "idle" | "uploading" | "indexing";

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

function documentStatusMeta(status: string): { label: string; dot: string; badge: string } {
  switch (status) {
    case "pending":
      return { label: "En cola", dot: "bg-amber-400", badge: "text-amber-300 bg-amber-400/10 border-amber-400/20" };
    case "processing":
      return { label: "Indexando…", dot: "bg-violet-400", badge: "text-violet-300 bg-violet-400/10 border-violet-400/20" };
    case "indexed":
      return { label: "Listo", dot: "bg-emerald-400", badge: "text-emerald-300 bg-emerald-400/10 border-emerald-400/20" };
    case "error":
      return { label: "Error", dot: "bg-rose-400", badge: "text-rose-300 bg-rose-400/10 border-rose-400/20" };
    default:
      return { label: status, dot: "bg-zinc-600", badge: "text-zinc-400 bg-zinc-400/10 border-zinc-400/20" };
  }
}

function formatDocError(msg: string): string {
  return msg.replace(/^\[GoogleGenerativeAI Error\]:\s*/i, "").trim();
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const IconBot = () => (
  <svg viewBox="0 0 24 24" fill="none" className="size-4" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
  </svg>
);

const IconUser = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
    <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z" clipRule="evenodd" />
  </svg>
);

const IconUpload = () => (
  <svg viewBox="0 0 24 24" fill="none" className="size-4" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
  </svg>
);

const IconDocument = () => (
  <svg viewBox="0 0 24 24" fill="none" className="size-3.5 shrink-0" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
  </svg>
);

const IconSend = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
    <path d="M3.478 2.405a.75.75 0 0 0-.926.94l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.405Z" />
  </svg>
);

const IconRefresh = () => (
  <svg viewBox="0 0 24 24" fill="none" className="size-3" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
);

const IconTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" className="size-3" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
  </svg>
);

const IconChevron = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" className={`size-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`} stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
  </svg>
);

const IconMenu = () => (
  <svg viewBox="0 0 24 24" fill="none" className="size-5" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

// ── Collapsible citation group ─────────────────────────────────────────────
function CitationGroup({ group, docNumber }: { group: GroupedCitation; docNumber: number }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-b from-white/[0.05] to-white/[0.02] shadow-lg shadow-black/20 ring-1 ring-white/[0.04] backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400/40"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/35 to-cyan-500/20 text-[10px] font-bold tabular-nums text-violet-100 ring-1 ring-white/10">
          {docNumber}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="text-violet-300/70"><IconDocument /></span>
          <span className="truncate text-xs font-medium tracking-tight text-zinc-100">{group.title}</span>
        </span>
        <span className="shrink-0 text-zinc-500"><IconChevron open={open} /></span>
      </button>
      {open && (
        <div className="divide-y divide-white/[0.05] border-t border-white/[0.06] bg-black/15">
          {group.chunks.map((chunk) => (
            <div key={chunk.chunkId} className="px-3.5 py-3">
              {chunk.page != null && (
                <span className="mb-1.5 inline-block rounded-md border border-white/[0.06] bg-zinc-900/80 px-2 py-0.5 text-[10px] font-medium text-cyan-200/90">
                  pág. {chunk.page}
                </span>
              )}
              <p className="text-[11px] leading-relaxed text-zinc-400 line-clamp-4">
                {chunk.excerpt}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export function ChatApp() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseRow[]>([]);
  const [kbId, setKbId] = useState<string>("");
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loadingKb, setLoadingKb] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sources, setSources] = useState<Citation[]>([]);
  const [toast, setToast] = useState<ToastState>(null);
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);
  const [mobileSourcesOpen, setMobileSourcesOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollAttemptsRef = useRef(0);
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

  const loadKnowledgeBases = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/knowledge-bases"), { credentials: "include" });
      const data = (await res.json()) as { knowledgeBases: KnowledgeBaseRow[] };
      setKnowledgeBases(data.knowledgeBases ?? []);
      setKbId((id) => id || data.knowledgeBases?.[0]?.id || "");
    } catch { setKnowledgeBases([]); }
    finally { setLoadingKb(false); }
  }, []);

  const fetchDocuments = useCallback(async (id: string): Promise<DocumentRow[]> => {
    if (!id) return [];
    try {
      const res = await fetch(apiUrl(`/api/documents?knowledgeBaseId=${encodeURIComponent(id)}`), {
        credentials: "include",
      });
      const data = (await res.json()) as { documents: DocumentRow[] };
      return data.documents ?? [];
    } catch { return []; }
  }, []);

  const loadDocuments = useCallback(async (id: string) => {
    const docs = await fetchDocuments(id);
    setDocuments(docs);
  }, [fetchDocuments]);

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

  const stopIndexingPoll = useCallback(() => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    pollAttemptsRef.current = 0;
  }, []);

  const startIndexingPoll = useCallback(() => {
    stopIndexingPoll();
    const run = async () => {
      pollAttemptsRef.current += 1;
      const docs = await fetchDocuments(kbId);
      setDocuments(docs);
      const busy = docs.some((d) => d.status === "pending" || d.status === "processing");
      if (!busy || pollAttemptsRef.current >= 140) {
        stopIndexingPoll(); setUploadPhase("idle"); setReindexingId(null);
      }
    };
    void run();
    pollTimerRef.current = setInterval(() => void run(), 1800);
  }, [kbId, fetchDocuments, stopIndexingPoll]);

  const reindexDoc = useCallback(async (documentId: string) => {
    setReindexingId(documentId);
    try {
      const res = await fetch(apiUrl(`/api/documents/${documentId}/reindex`), {
        method: "POST",
        headers: { ...aiRequestHeaders() },
        credentials: "include",
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setReindexingId(null);
        pushToast(err.error ?? "No se pudo reindexar", "error");
        return;
      }
      await loadDocuments(kbId);
      startIndexingPoll();
    } catch {
      setReindexingId(null);
      pushToast("Error de red al reindexar", "error");
    }
  }, [kbId, loadDocuments, startIndexingPoll, pushToast]);

  const deleteDoc = useCallback(async (documentId: string, title: string) => {
    if (!window.confirm(`¿Eliminar "${title}"? Se borrará el archivo y todos sus fragmentos.`)) return;
    setDeletingId(documentId);
    try {
      const res = await fetch(apiUrl(`/api/documents/${documentId}`), {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        pushToast(err.error ?? "No se pudo eliminar", "error");
        return;
      }
      await loadDocuments(kbId);
      setSources((prev) => prev.filter((c) => c.documentId !== documentId));
    } catch {
      pushToast("Error de red al eliminar", "error");
    }
    finally { setDeletingId(null); }
  }, [kbId, loadDocuments, pushToast]);

  useEffect(() => { startTransition(() => { void loadKnowledgeBases(); }); }, [loadKnowledgeBases]);

  useEffect(() => {
    stopIndexingPoll();
    startTransition(() => {
      setConversationId(null);
      setMessages([]);
      setSources([]);
      setUploadPhase("idle"); setReindexingId(null); setDeletingId(null);
      void loadDocuments(kbId);
      void loadConversations(kbId);
    });
  }, [kbId, loadDocuments, loadConversations, stopIndexingPoll]);

  useEffect(() => () => stopIndexingPoll(), [stopIndexingPoll]);

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

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !kbId) return;
    setUploadPhase("uploading");
    try {
      const fd = new FormData();
      fd.set("file", file); fd.set("knowledgeBaseId", kbId);
      const res = await fetch(apiUrl("/api/documents"), {
        method: "POST",
        headers: { ...aiRequestHeaders() },
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setUploadPhase("idle");
        pushToast(err.error ?? "Error al subir", "error");
        return;
      }
      setUploadPhase("indexing");
      await loadDocuments(kbId);
      startIndexingPoll();
    } catch {
      setUploadPhase("idle");
      pushToast("Error al subir el archivo", "error");
    }
  };

  const indexingBusy = uploadPhase !== "idle" || documents.some((d) => d.status === "pending" || d.status === "processing");
  const groupedSources = groupCitations(sources);
  const activeKbName = knowledgeBases.find((k) => k.id === kbId)?.name ?? null;

  const sourcesPanelInner =
    groupedSources.length === 0 ? (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-gradient-to-br from-zinc-800/50 to-zinc-900/30 text-zinc-500 ring-1 ring-white/[0.04]">
          <IconDocument />
        </div>
        <p className="max-w-[14rem] text-xs leading-relaxed text-zinc-500">
          Tras cada respuesta verás aquí los fragmentos citados del documento.
        </p>
      </div>
    ) : (
      <div className="space-y-2">
        {groupedSources.map((group, i) => (
          <CitationGroup key={group.documentId} group={group} docNumber={i + 1} />
        ))}
      </div>
    );

  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col text-zinc-100 md:flex-row">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="absolute -left-[25%] -top-[10%] h-[min(85vh,780px)] w-[min(90vw,640px)] rounded-full bg-violet-600/[0.14] blur-[130px]" />
        <div className="absolute -right-[20%] top-[20%] h-[min(55vh,480px)] w-[min(75vw,520px)] rounded-full bg-cyan-400/[0.09] blur-[110px]" />
        <div className="absolute bottom-[-15%] left-[30%] h-[min(45vh,400px)] w-[min(60vw,440px)] rounded-full bg-fuchsia-600/[0.07] blur-[100px]" />
      </div>

      {toast && (
        <div
          className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3 max-sm:px-2"
          style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
          role="status"
          aria-live="polite"
        >
          <div
            className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-xl ${
              toast.tone === "error"
                ? "border-rose-400/25 bg-rose-950/90 text-rose-50 ring-1 ring-rose-500/20"
                : "border-white/[0.12] bg-zinc-950/85 text-zinc-50 ring-1 ring-violet-500/15"
            }`}
          >
            <span className="flex-1 leading-snug">{toast.message}</span>
            <button
              type="button"
              className="rounded-lg px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
              onClick={() => setToast(null)}
              aria-label="Cerrar aviso"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {mobileSidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-[84] bg-black/60 backdrop-blur-sm md:hidden"
          aria-label="Cerrar menú de biblioteca"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar (drawer en móvil, columna fija en md+) ───────────────── */}
      <aside
        className={`flex h-[100dvh] shrink-0 flex-col border-white/[0.06] bg-zinc-950/95 backdrop-blur-2xl transition-transform duration-300 ease-out supports-[backdrop-filter]:bg-zinc-950/80 md:h-auto md:min-h-0 md:bg-zinc-950/35 supports-[backdrop-filter]:md:bg-zinc-950/25 ${
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } fixed inset-y-0 left-0 z-[85] w-[min(22rem,calc(100vw-8px))] border-r pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-2xl shadow-black/50 md:relative md:inset-auto md:z-auto md:w-[19rem] md:translate-x-0 md:border-b-0 md:border-r md:py-0 md:pb-0 md:pt-0 md:shadow-none`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3 md:hidden">
          <span className="text-sm font-semibold tracking-tight text-zinc-100">Biblioteca</span>
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            className="rounded-lg border border-white/[0.1] bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
          >
            Cerrar
          </button>
        </div>
        {/* Brand */}
        <div className="border-b border-white/[0.06] px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="relative flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 p-[1px] shadow-lg shadow-violet-600/25 ring-1 ring-white/10">
              <div className="flex size-full items-center justify-center rounded-2xl bg-zinc-950/90">
                <svg viewBox="0 0 24 24" fill="none" className="size-[18px] text-violet-200" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                </svg>
              </div>
            </div>
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold tracking-tight text-gradient-brand">RAG Studio</h1>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">Postgres · pgvector</p>
            </div>
          </div>
        </div>

        {/* Conversaciones */}
        <div className="border-b border-white/[0.06] px-4 py-4">
          <div className="mb-2.5 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Conversaciones</p>
            <button
              type="button"
              onClick={startNewConversation}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-zinc-300 transition-all hover:border-violet-400/35 hover:bg-violet-500/10 hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/45"
            >
              Nueva
            </button>
          </div>
          <div className="max-h-36 space-y-1.5 overflow-y-auto">
            {loadingConversations ? (
              <div className="space-y-2 py-0.5" aria-busy="true" aria-label="Cargando conversaciones">
                <div className="h-10 animate-pulse rounded-xl bg-gradient-to-r from-white/[0.04] to-white/[0.08]" />
                <div className="h-10 animate-pulse rounded-xl bg-gradient-to-r from-white/[0.04] to-white/[0.08]" />
                <div className="h-10 w-4/5 animate-pulse rounded-xl bg-gradient-to-r from-white/[0.04] to-white/[0.08]" />
              </div>
            ) : conversations.length === 0 ? (
              <p className="text-[11px] leading-relaxed text-zinc-600">Sin historial aún.</p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => void openConversationFromSidebar(c.id)}
                  className={`group flex w-full flex-col rounded-xl border px-3 py-2 text-left text-[11px] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40 ${
                    conversationId === c.id
                      ? "border-violet-500/35 bg-gradient-to-r from-violet-500/15 to-cyan-500/5 text-zinc-100 shadow-md shadow-violet-900/20 ring-1 ring-violet-400/20"
                      : "border-transparent bg-white/[0.02] text-zinc-400 hover:border-white/[0.08] hover:bg-white/[0.05] hover:text-zinc-200"
                  }`}
                >
                  <span className="truncate font-medium tracking-tight">{c.title || "Sin título"}</span>
                  <span className="truncate text-[10px] text-zinc-600 group-hover:text-zinc-500">{formatShortDate(c.updatedAt)}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* KB selector */}
        <div className="space-y-3 px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Base de conocimiento</p>
          <select
            aria-label="Base de conocimiento activa"
            className="w-full cursor-pointer rounded-xl border border-white/[0.08] bg-zinc-900/50 px-3.5 py-2.5 text-sm text-zinc-100 shadow-inner shadow-black/20 outline-none ring-1 ring-white/[0.03] transition-all hover:border-violet-400/25 focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            value={kbId}
            onChange={(e) => setKbId(e.target.value)}
            disabled={loadingKb || knowledgeBases.length === 0}
          >
            {knowledgeBases.length === 0 ? (
              <option value="">Ejecuta npm run db:seed</option>
            ) : (
              knowledgeBases.map((kb) => (
                <option key={kb.id} value={kb.id}>{kb.name}</option>
              ))
            )}
          </select>

          {/* Upload */}
          <label
            className={`group flex cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-dashed px-3 py-3.5 text-xs font-medium transition-all duration-300 focus-within:border-violet-400/45 focus-within:shadow-[0_0_0_3px_rgba(139,92,246,0.15)] ${
              uploadPhase !== "idle"
                ? "cursor-wait border-violet-400/35 bg-violet-500/10 text-violet-200"
                : "border-white/[0.1] bg-gradient-to-br from-white/[0.04] to-transparent text-zinc-500 hover:border-cyan-400/25 hover:bg-cyan-500/[0.06] hover:text-zinc-300"
            }`}
          >
            <input type="file" className="hidden" accept=".pdf,.txt,.md" onChange={onUpload} disabled={!kbId || uploadPhase !== "idle"} />
            {uploadPhase !== "idle" ? (
              <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-violet-400/50 border-t-cyan-300" />
            ) : (
              <span className="text-violet-300/80 transition-colors group-hover:text-cyan-300/90"><IconUpload /></span>
            )}
            {uploadPhase === "uploading" ? "Subiendo…" : uploadPhase === "indexing" ? "Indexando…" : "Subir PDF o texto"}
          </label>
        </div>

        {/* Document list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Archivos</p>
            {indexingBusy && (
              <span className="flex items-center gap-1.5 text-[10px] font-medium text-cyan-300/90">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan-400/40 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
                </span>
                Procesando
              </span>
            )}
          </div>
          {indexingBusy && (
            <div className="mb-3 h-1 overflow-hidden rounded-full bg-zinc-800/80 ring-1 ring-white/[0.05]">
              <div className="h-full w-1/2 animate-shimmer-slow rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400" />
            </div>
          )}
          {documents.length === 0 ? (
            <p className="text-xs leading-relaxed text-zinc-600">Ningún documento aún.</p>
          ) : (
            <ul className="space-y-2.5">
              {documents.map((d) => {
                const meta = documentStatusMeta(d.status);
                const rowBusy = d.status === "pending" || d.status === "processing" || reindexingId === d.id || deletingId === d.id;
                return (
                  <li
                    key={d.id}
                    className="group rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.05] to-white/[0.02] p-3 shadow-md shadow-black/25 ring-1 ring-white/[0.03] transition-all hover:border-white/[0.1] hover:shadow-lg hover:shadow-violet-950/30"
                  >
                    <div className="flex items-start gap-2.5">
                      {rowBusy ? (
                        <span className="mt-0.5 size-4 shrink-0 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-400" />
                      ) : (
                        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${meta.dot}`} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold tracking-tight text-zinc-100">{d.title}</div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${meta.badge}`}>
                            {meta.label}
                          </span>
                          {d.status !== "processing" && (
                            <>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-zinc-900/40 px-2 py-1 text-[10px] text-zinc-400 transition-all hover:border-violet-400/35 hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/45 disabled:cursor-not-allowed disabled:opacity-30"
                                disabled={uploadPhase !== "idle" || reindexingId !== null || deletingId !== null}
                                onClick={() => void reindexDoc(d.id)}
                              >
                                <IconRefresh />
                                {reindexingId === d.id ? "…" : "Reindexar"}
                              </button>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-zinc-900/40 px-2 py-1 text-[10px] text-zinc-500 transition-all hover:border-rose-400/35 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/45 disabled:cursor-not-allowed disabled:opacity-30"
                                disabled={uploadPhase !== "idle" || reindexingId !== null || deletingId !== null}
                                onClick={() => void deleteDoc(d.id, d.title)}
                              >
                                <IconTrash />
                                {deletingId === d.id ? "…" : "Eliminar"}
                              </button>
                            </>
                          )}
                        </div>
                        {d.statusMessage && (
                          <p className="mt-2 max-h-20 overflow-y-auto break-words text-[10px] leading-relaxed text-amber-400/80">
                            {formatDocError(d.statusMessage)}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* ── Main chat area ────────────────────────────────────────────────── */}
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] bg-zinc-950/30 px-3 py-3 backdrop-blur-xl pt-[max(0.75rem,env(safe-area-inset-top))] sm:gap-3 sm:px-6 sm:py-3.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <button
              type="button"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.05] text-zinc-100 transition-colors hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 md:hidden"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Abrir biblioteca: bases, archivos y conversaciones"
            >
              <IconMenu />
            </button>
            <div className="relative flex size-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/20 to-cyan-500/15 ring-1 ring-emerald-400/25">
              <span className="absolute inset-0 rounded-2xl bg-gradient-to-t from-transparent to-white/[0.06]" />
              <span className="relative size-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.65)]" />
            </div>
            <div className="min-w-0">
              <span className="block truncate text-sm font-semibold tracking-tight text-zinc-50">Asistente IA</span>
              {activeKbName ? (
                <span className="mt-0.5 block truncate text-[11px] text-zinc-500">Base activa · <span className="text-zinc-400">{activeKbName}</span></span>
              ) : (
                <>
                  <span className="mt-0.5 block text-[11px] text-zinc-600 md:hidden">Toca <span className="font-medium text-zinc-500">Menú</span> para elegir una base.</span>
                  <span className="mt-0.5 hidden text-[11px] text-zinc-600 md:block">Selecciona una base en la barra lateral.</span>
                </>
              )}
            </div>
          </div>
          <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            {sources.length > 0 && (
              <button
                type="button"
                onClick={() => setMobileSourcesOpen(true)}
                className="rounded-xl border border-cyan-400/20 bg-gradient-to-r from-cyan-500/15 to-violet-500/10 px-2.5 py-2 text-[11px] font-medium leading-none text-cyan-100 shadow-sm shadow-cyan-900/20 transition-all hover:border-cyan-400/35 hover:from-cyan-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/45 sm:px-3 sm:text-xs lg:hidden"
              >
                Fuentes ({sources.length})
              </button>
            )}
            <button
              type="button"
              onClick={startNewConversation}
              className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-medium text-zinc-300 transition-all hover:border-violet-400/30 hover:bg-violet-500/10 hover:text-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/45"
            >
              <span className="sm:hidden">Nueva</span>
              <span className="hidden sm:inline">Nueva charla</span>
            </button>
            <Link
              href="/settings"
              onClick={() => setMobileSidebarOpen(false)}
              className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-medium text-zinc-300 transition-all hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/45"
            >
              <span className="sm:hidden">IA</span>
              <span className="hidden sm:inline">Ajustes IA</span>
            </Link>
          </div>
        </header>

        {/* Messages */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-6 sm:px-6 sm:py-8">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 py-10 text-center">
              <div className="relative w-full max-w-lg">
                <div
                  className="pointer-events-none absolute -inset-8 -z-10 opacity-90 blur-3xl"
                  style={{
                    background:
                      "radial-gradient(ellipse 70% 55% at 50% 40%, rgba(139, 92, 246, 0.22) 0%, transparent 65%), radial-gradient(ellipse 50% 40% at 80% 20%, rgba(34, 211, 238, 0.12) 0%, transparent 55%)",
                  }}
                />
                <div className="rounded-3xl border border-white/[0.1] bg-zinc-950/50 p-6 shadow-2xl shadow-violet-950/20 ring-1 ring-white/[0.06] backdrop-blur-2xl sm:p-10">
                  <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/25 via-fuchsia-500/15 to-cyan-500/20 ring-1 ring-white/10">
                    <span className="text-violet-200"><IconBot /></span>
                  </div>
                  <h2 className="mb-2 text-lg font-semibold tracking-tight text-zinc-50">¿En qué puedo ayudarte?</h2>
                  <p className="mb-8 text-sm leading-relaxed text-zinc-500">
                    Respuestas ancladas a tus documentos. Las citas aparecen en{" "}
                    <span className="font-medium text-zinc-400">Fuentes</span> cuando hay fragmentos recuperados
                    (en móvil, el botón queda arriba a la derecha).
                  </p>
                  {kbId ? (
                    <div className="space-y-3 text-left">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600">Prueba con</p>
                      <div className="flex flex-col gap-2.5">
                        {CHAT_SUGGESTIONS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => {
                              setInput(s);
                              textareaRef.current?.focus();
                            }}
                            className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-left text-xs leading-snug text-zinc-400 transition-all hover:border-violet-400/30 hover:bg-gradient-to-r hover:from-violet-500/10 hover:to-cyan-500/5 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-100/90">
                      <p className="md:hidden">Abre <span className="font-medium">Menú</span> (arriba a la izquierda) y elige una base de conocimiento.</p>
                      <p className="hidden md:block">Selecciona una base de conocimiento en la barra lateral para empezar.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <ul className="mx-auto max-w-3xl space-y-7">
              {messages.map((msg, i) => (
                <li key={msg.id ?? `m-${i}`} className={`flex gap-3.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  {/* Avatar */}
                  <div className={`flex size-8 shrink-0 items-center justify-center rounded-xl text-xs ${
                    msg.role === "user"
                      ? "bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-lg shadow-fuchsia-900/35 ring-1 ring-white/15"
                      : "border border-white/[0.1] bg-zinc-900/70 text-violet-300/90 shadow-inner shadow-black/30 backdrop-blur-sm"
                  }`}>
                    {msg.role === "user" ? <IconUser /> : <IconBot />}
                  </div>

                  {/* Bubble */}
                  <div className={`max-w-[min(90vw,42rem)] rounded-2xl px-3 py-2.5 text-sm leading-relaxed sm:max-w-[80%] sm:px-4 sm:py-3.5 ${
                    msg.role === "user"
                      ? "rounded-tr-sm bg-gradient-to-br from-violet-600 via-fuchsia-600 to-violet-700 text-white shadow-xl shadow-violet-950/40 ring-1 ring-white/10"
                      : msg.content.startsWith("Error del modelo:") || msg.content.startsWith("⚠️") || /^\[\d{3}\]/.test(msg.content)
                        ? "rounded-tl-sm border border-amber-400/25 bg-gradient-to-b from-amber-500/12 to-amber-950/20 text-amber-100/95 ring-1 ring-amber-400/15"
                        : "rounded-tl-sm border border-white/[0.08] bg-zinc-900/55 text-zinc-100 shadow-lg shadow-black/20 ring-1 ring-white/[0.04] backdrop-blur-md"
                  }`}>
                    {msg.role === "assistant" ? (
                      msg.content.startsWith("Error del modelo:") || msg.content.startsWith("⚠️") || /^\[\d{3}\]/.test(msg.content) ? (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      ) : (
                        <div className="prose prose-invert prose-sm max-w-none prose-p:my-1.5 prose-headings:my-2 prose-code:text-violet-200 prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/10">
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
                <li className="flex gap-3.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-zinc-900/70 text-violet-300/80 backdrop-blur-sm">
                    <IconBot />
                  </div>
                  <div className="flex items-center gap-3 rounded-2xl rounded-tl-sm border border-white/[0.08] bg-zinc-900/50 px-4 py-3.5 ring-1 ring-white/[0.04] backdrop-blur-md">
                    <span className="inline-flex items-end gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fuchsia-400/90 [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400/80" />
                    </span>
                    <span className="text-xs font-medium text-zinc-500">Generando…</span>
                  </div>
                </li>
              )}
              <div ref={bottomRef} />
            </ul>
          )}
        </div>

        {/* Input */}
        <footer className="shrink-0 border-t border-white/[0.06] bg-gradient-to-t from-zinc-950/80 to-transparent px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:px-6">
          <div className="mx-auto max-w-3xl">
            <div className="flex flex-col gap-2 rounded-2xl border border-white/[0.1] bg-zinc-900/60 p-2 shadow-2xl shadow-black/40 ring-1 ring-white/[0.05] backdrop-blur-xl transition-all focus-within:border-violet-400/35 focus-within:shadow-violet-950/25 focus-within:ring-violet-500/20 sm:flex-row sm:items-end sm:gap-2 sm:p-1.5">
              <textarea
                ref={textareaRef}
                className="min-h-[44px] w-full flex-1 resize-none rounded-xl bg-transparent px-3 py-2.5 text-base text-zinc-100 outline-none placeholder:text-zinc-600 focus-visible:outline-none sm:min-h-[40px] sm:text-sm"
                rows={1}
                placeholder={kbId ? "Escribe tu pregunta…" : "Elige una base de conocimiento"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
                }}
                disabled={!kbId || sending}
                aria-label="Mensaje para el asistente"
              />
              <button
                type="button"
                className="flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/40 ring-1 ring-white/15 transition-all hover:brightness-110 hover:shadow-violet-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100 sm:w-auto sm:py-2.5 sm:text-xs"
                onClick={() => void send()}
                disabled={!kbId || sending || !input.trim()}
                aria-busy={sending}
                aria-label="Enviar mensaje"
              >
                <IconSend />
                Enviar
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] font-medium tracking-wide text-zinc-600">Enter envía · Shift+Enter nueva línea</p>
          </div>
        </footer>
      </main>

      {/* ── Sources panel ─────────────────────────────────────────────────── */}
      <section className="hidden w-72 shrink-0 flex-col border-l border-white/[0.06] bg-zinc-950/30 backdrop-blur-2xl lg:flex lg:w-[19.5rem] lg:supports-[backdrop-filter]:bg-zinc-950/20">
        <div className="border-b border-white/[0.06] px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Fuentes</h2>
            {sources.length > 0 && (
              <span className="shrink-0 rounded-full border border-violet-400/20 bg-gradient-to-r from-violet-500/20 to-cyan-500/15 px-2.5 py-0.5 text-[10px] font-semibold tabular-nums text-violet-200 ring-1 ring-white/5">
                {groupedSources.length} {groupedSources.length === 1 ? "doc" : "docs"}
              </span>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3.5">{sourcesPanelInner}</div>
      </section>

      {mobileSourcesOpen && (
        <div className="fixed inset-0 z-[90] lg:hidden" role="dialog" aria-modal="true" aria-labelledby="mobile-sources-title">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileSourcesOpen(false)}
            aria-label="Cerrar panel de fuentes"
          />
          <div className="absolute bottom-0 left-0 right-0 flex max-h-[min(88vh,560px)] flex-col overflow-hidden rounded-t-3xl border border-white/[0.1] bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] shadow-2xl shadow-violet-950/30 ring-1 ring-white/[0.06] backdrop-blur-2xl">
            <div className="flex justify-center pt-2">
              <span className="h-1 w-10 rounded-full bg-zinc-700" aria-hidden />
            </div>
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3.5">
              <h2 id="mobile-sources-title" className="text-sm font-semibold tracking-tight text-zinc-100">
                Fuentes
              </h2>
              <button
                type="button"
                onClick={() => setMobileSourcesOpen(false)}
                className="rounded-xl border border-white/[0.1] bg-white/[0.06] px-3.5 py-2 text-xs font-medium text-zinc-300 transition-all hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
              >
                Cerrar
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3.5">{sourcesPanelInner}</div>
          </div>
        </div>
      )}
    </div>
  );
}
