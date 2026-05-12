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
type DocumentRow = {
  id: string;
  title: string;
  fileName: string;
  status: string;
  statusMessage: string | null;
  createdAt: string;
};
type UploadPhase = "idle" | "uploading" | "indexing";

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

// ── Collapsible citation group ─────────────────────────────────────────────
function CitationGroup({ group, docNumber }: { group: GroupedCitation; docNumber: number }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-indigo-500/20 text-[10px] font-bold text-indigo-300">
          {docNumber}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="text-indigo-300/60"><IconDocument /></span>
          <span className="truncate text-xs font-medium text-zinc-200">{group.title}</span>
        </span>
        <span className="shrink-0 text-zinc-600"><IconChevron open={open} /></span>
      </button>
      {open && (
        <div className="divide-y divide-white/[0.04] border-t border-white/[0.04]">
          {group.chunks.map((chunk) => (
            <div key={chunk.chunkId} className="px-3 py-2.5">
              {chunk.page != null && (
                <span className="mb-1.5 inline-block rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                  pág. {chunk.page}
                </span>
              )}
              <p className="text-[11px] leading-relaxed text-zinc-500 line-clamp-4">
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
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loadingKb, setLoadingKb] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sources, setSources] = useState<Citation[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollAttemptsRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => bottomRef.current?.scrollIntoView({ behavior: "smooth" });

  useEffect(() => { scrollToBottom(); }, [messages, sending]);

  const loadKnowledgeBases = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/knowledge-bases"));
      const data = (await res.json()) as { knowledgeBases: KnowledgeBaseRow[] };
      setKnowledgeBases(data.knowledgeBases ?? []);
      setKbId((id) => id || data.knowledgeBases?.[0]?.id || "");
    } catch { setKnowledgeBases([]); }
    finally { setLoadingKb(false); }
  }, []);

  const fetchDocuments = useCallback(async (id: string): Promise<DocumentRow[]> => {
    if (!id) return [];
    try {
      const res = await fetch(apiUrl(`/api/documents?knowledgeBaseId=${encodeURIComponent(id)}`));
      const data = (await res.json()) as { documents: DocumentRow[] };
      return data.documents ?? [];
    } catch { return []; }
  }, []);

  const loadDocuments = useCallback(async (id: string) => {
    const docs = await fetchDocuments(id);
    setDocuments(docs);
  }, [fetchDocuments]);

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
        method: "POST", headers: { ...aiRequestHeaders() },
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setReindexingId(null); alert(err.error ?? "No se pudo reindexar"); return;
      }
      await loadDocuments(kbId);
      startIndexingPoll();
    } catch { setReindexingId(null); alert("Error de red al reindexar"); }
  }, [kbId, loadDocuments, startIndexingPoll]);

  const deleteDoc = useCallback(async (documentId: string, title: string) => {
    if (!window.confirm(`¿Eliminar "${title}"? Se borrará el archivo y todos sus fragmentos.`)) return;
    setDeletingId(documentId);
    try {
      const res = await fetch(apiUrl(`/api/documents/${documentId}`), { method: "DELETE" });
      if (!res.ok) { const err = (await res.json()) as { error?: string }; alert(err.error ?? "No se pudo eliminar"); return; }
      await loadDocuments(kbId);
      setSources((prev) => prev.filter((c) => c.documentId !== documentId));
    } catch { alert("Error de red al eliminar"); }
    finally { setDeletingId(null); }
  }, [kbId, loadDocuments]);

  useEffect(() => { startTransition(() => { void loadKnowledgeBases(); }); }, [loadKnowledgeBases]);

  useEffect(() => {
    stopIndexingPoll();
    startTransition(() => {
      setUploadPhase("idle"); setReindexingId(null); setDeletingId(null);
      void loadDocuments(kbId);
    });
  }, [kbId, loadDocuments, stopIndexingPoll]);

  useEffect(() => () => stopIndexingPoll(), [stopIndexingPoll]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const userMsg: ChatMessage = { role: "user", content: text };
    setInput(""); setMessages((m) => [...m, userMsg]);
    setSending(true); setSources([]);
    try {
      const res = await fetch(apiUrl("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...aiRequestHeaders() },
        body: JSON.stringify({
          messages: [...messages, userMsg].map(({ role, content }) => ({ role, content })),
          knowledgeBaseId: kbId || undefined,
        }),
      });
      const data = (await res.json()) as { reply?: string; citations?: Citation[]; error?: string };
      if (!res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: data.error ?? "Error al contactar el servidor." }]);
        return;
      }
      const citations = data.citations ?? [];
      setSources(citations);
      setMessages((m) => [...m, { role: "assistant", content: data.reply ?? "", citations }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "No se pudo conectar. Revisa tu red o el servidor." }]);
    } finally { setSending(false); }
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
        method: "POST", headers: { ...aiRequestHeaders() }, body: fd,
      });
      if (!res.ok) { const err = (await res.json()) as { error?: string }; setUploadPhase("idle"); alert(err.error ?? "Error al subir"); return; }
      setUploadPhase("indexing");
      await loadDocuments(kbId);
      startIndexingPoll();
    } catch { setUploadPhase("idle"); alert("Error al subir el archivo"); }
  };

  const indexingBusy = uploadPhase !== "idle" || documents.some((d) => d.status === "pending" || d.status === "processing");
  const groupedSources = groupCitations(sources);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#08080f] text-zinc-100 md:flex-row">

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside className="flex w-full shrink-0 flex-col border-b border-white/[0.06] md:w-72 md:border-r md:border-b-0">
        {/* Brand */}
        <div className="border-b border-white/[0.06] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/20">
              <svg viewBox="0 0 24 24" fill="none" className="size-4 text-white" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight text-white">RAG Documents</h1>
              <p className="text-[10px] text-zinc-500">Postgres · pgvector</p>
            </div>
          </div>
        </div>

        {/* KB selector */}
        <div className="space-y-3 px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Base de conocimiento</p>
          <select
            className="w-full rounded-lg border border-white/[0.07] bg-white/[0.04] px-3 py-2 text-sm text-zinc-200 outline-none transition-colors focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40 disabled:opacity-50"
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
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs transition-all duration-200 ${
              uploadPhase !== "idle"
                ? "cursor-wait border-indigo-500/30 bg-indigo-500/5 text-indigo-300"
                : "border-white/[0.08] text-zinc-500 hover:border-indigo-500/40 hover:bg-indigo-500/5 hover:text-zinc-300"
            }`}
          >
            <input type="file" className="hidden" accept=".pdf,.txt,.md" onChange={onUpload} disabled={!kbId || uploadPhase !== "idle"} />
            {uploadPhase !== "idle" ? (
              <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
            ) : (
              <span className="text-indigo-400/60"><IconUpload /></span>
            )}
            {uploadPhase === "uploading" ? "Subiendo…" : uploadPhase === "indexing" ? "Indexando…" : "Subir PDF / texto"}
          </label>
        </div>

        {/* Document list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Archivos</p>
            {indexingBusy && (
              <span className="flex items-center gap-1 text-[10px] text-indigo-400">
                <span className="size-1.5 animate-pulse rounded-full bg-indigo-400" />
                Procesando
              </span>
            )}
          </div>
          {indexingBusy && (
            <div className="mb-3 h-0.5 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full w-3/5 animate-pulse rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" />
            </div>
          )}
          {documents.length === 0 ? (
            <p className="text-xs text-zinc-700">Ningún documento aún.</p>
          ) : (
            <ul className="space-y-2">
              {documents.map((d) => {
                const meta = documentStatusMeta(d.status);
                const rowBusy = d.status === "pending" || d.status === "processing" || reindexingId === d.id || deletingId === d.id;
                return (
                  <li key={d.id} className="group rounded-xl border border-white/[0.05] bg-white/[0.02] p-2.5 transition-colors hover:border-white/[0.08] hover:bg-white/[0.04]">
                    <div className="flex items-start gap-2">
                      {rowBusy ? (
                        <span className="mt-0.5 size-3.5 shrink-0 animate-spin rounded-full border-2 border-zinc-700 border-t-indigo-400" />
                      ) : (
                        <span className={`mt-1 size-1.5 shrink-0 rounded-full ${meta.dot}`} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-zinc-200">{d.title}</div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${meta.badge}`}>
                            {meta.label}
                          </span>
                          {d.status !== "processing" && (
                            <>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-indigo-500/30 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-30"
                                disabled={uploadPhase !== "idle" || reindexingId !== null || deletingId !== null}
                                onClick={() => void reindexDoc(d.id)}
                              >
                                <IconRefresh />
                                {reindexingId === d.id ? "…" : "Reindexar"}
                              </button>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:border-rose-500/30 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-30"
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
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 ring-1 ring-emerald-500/30">
              <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
            </div>
            <span className="text-sm font-medium text-zinc-200">Asistente IA</span>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href="/settings"
              className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-indigo-500/30 hover:text-indigo-300"
            >
              Ajustes IA
            </Link>
          </div>
        </header>

        {/* Messages */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <div className="relative">
                <div className="absolute inset-0 -z-10 blur-3xl" style={{ background: "radial-gradient(ellipse at center, rgba(99,102,241,0.12) 0%, transparent 70%)" }} />
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-8 py-10 shadow-2xl backdrop-blur-sm">
                  <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 ring-1 ring-indigo-500/30">
                    <span className="text-indigo-300"><IconBot /></span>
                  </div>
                  <h2 className="mb-2 text-base font-semibold text-zinc-200">¿En qué puedo ayudarte?</h2>
                  <p className="max-w-xs text-sm leading-relaxed text-zinc-500">
                    Haz una pregunta sobre tus documentos. Las fuentes con los fragmentos recuperados aparecerán a la derecha.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <ul className="mx-auto max-w-3xl space-y-6">
              {messages.map((msg, i) => (
                <li key={`${i}-${msg.role}`} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  {/* Avatar */}
                  <div className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs ${
                    msg.role === "user"
                      ? "bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/20"
                      : "border border-white/[0.08] bg-white/[0.04] text-zinc-400"
                  }`}>
                    {msg.role === "user" ? <IconUser /> : <IconBot />}
                  </div>

                  {/* Bubble */}
                  <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                    msg.role === "user"
                      ? "rounded-tr-md bg-gradient-to-br from-indigo-600 to-violet-700 text-white"
                      : msg.content.startsWith("Error del modelo:") || msg.content.startsWith("⚠️")
                        ? "rounded-tl-md border border-amber-500/20 bg-amber-500/5 text-amber-200/90"
                        : "rounded-tl-md border border-white/[0.06] bg-white/[0.03] text-zinc-200"
                  }`}>
                    {msg.role === "assistant" ? (
                      msg.content.startsWith("Error del modelo:") || msg.content.startsWith("⚠️") ? (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      ) : (
                        <div className="prose prose-invert prose-sm max-w-none prose-p:my-1.5 prose-headings:my-2 prose-code:text-indigo-300 prose-pre:bg-white/5 prose-pre:border prose-pre:border-white/10">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      )
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>
                </li>
              ))}

              {/* Thinking indicator */}
              {sending && (
                <li className="flex gap-3">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-400">
                    <IconBot />
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl rounded-tl-md border border-white/[0.06] bg-white/[0.03] px-4 py-3">
                    <span className="inline-flex items-end gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400/70 [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400/40" />
                    </span>
                    <span className="text-xs text-zinc-500">Pensando…</span>
                  </div>
                </li>
              )}
              <div ref={bottomRef} />
            </ul>
          )}
        </div>

        {/* Input */}
        <footer className="shrink-0 border-t border-white/[0.06] p-4">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-end gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-2 transition-colors focus-within:border-indigo-500/40 focus-within:ring-1 focus-within:ring-indigo-500/20">
              <textarea
                ref={textareaRef}
                className="min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
                rows={1}
                placeholder={kbId ? "Escribe tu pregunta… (Enter para enviar)" : "Configura una base de conocimiento primero"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
                }}
                disabled={!kbId || sending}
              />
              <button
                type="button"
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-700 px-4 py-2 text-xs font-medium text-white shadow-lg shadow-indigo-500/20 transition-all hover:from-indigo-500 hover:to-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => void send()}
                disabled={!kbId || sending || !input.trim()}
              >
                <IconSend />
                Enviar
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-zinc-700">Shift+Enter para nueva línea</p>
          </div>
        </footer>
      </main>

      {/* ── Sources panel ─────────────────────────────────────────────────── */}
      <section className="hidden w-80 shrink-0 flex-col border-l border-white/[0.06] bg-white/[0.01] xl:flex">
        <div className="border-b border-white/[0.06] px-4 py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Fuentes</h2>
            {sources.length > 0 && (
              <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-400 ring-1 ring-indigo-500/20">
                {groupedSources.length} {groupedSources.length === 1 ? "doc" : "docs"}
              </span>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {groupedSources.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <div className="flex size-10 items-center justify-center rounded-xl border border-white/[0.05] bg-white/[0.02] text-zinc-600">
                <IconDocument />
              </div>
              <p className="text-xs leading-relaxed text-zinc-700">
                Las fuentes recuperadas aparecerán aquí tras cada respuesta.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {groupedSources.map((group, i) => (
                <CitationGroup key={group.documentId} group={group} docNumber={i + 1} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
