"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api-url";
import { aiRequestHeaders } from "@/lib/client-openai-key";

export type KnowledgeBaseRow = { id: string; name: string; createdAt: string };
export type DocumentRow = {
  id: string;
  title: string;
  fileName: string;
  status: string;
  statusMessage: string | null;
  createdAt: string;
};
export type UploadPhase = "idle" | "uploading" | "indexing";

type ToastState = { message: string; tone: "error" | "info" } | null;

export type UseKnowledgeBaseLibraryOptions = {
  /** When set and present in loaded bases, selects it once (e.g. from `?kb=`). */
  preferredKbId?: string | null;
};

export function useKnowledgeBaseLibrary(options?: UseKnowledgeBaseLibraryOptions) {
  const preferredKbId = options?.preferredKbId ?? null;
  const appliedPreferredRef = useRef<string | null>(null);

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseRow[]>([]);
  const [kbId, setKbId] = useState<string>("");
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loadingKb, setLoadingKb] = useState(true);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollAttemptsRef = useRef(0);

  const pushToast = useCallback((message: string, tone: "error" | "info" = "info") => {
    setToast({ message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const loadKnowledgeBases = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/knowledge-bases"), { credentials: "include" });
      const data = (await res.json()) as { knowledgeBases: KnowledgeBaseRow[] };
      setKnowledgeBases(data.knowledgeBases ?? []);
      setKbId((id) => id || data.knowledgeBases?.[0]?.id || "");
    } catch {
      setKnowledgeBases([]);
    } finally {
      setLoadingKb(false);
    }
  }, []);

  const fetchDocuments = useCallback(async (id: string): Promise<DocumentRow[]> => {
    if (!id) return [];
    try {
      const res = await fetch(apiUrl(`/api/documents?knowledgeBaseId=${encodeURIComponent(id)}`), {
        credentials: "include",
      });
      const data = (await res.json()) as { documents: DocumentRow[] };
      return data.documents ?? [];
    } catch {
      return [];
    }
  }, []);

  const loadDocuments = useCallback(
    async (id: string) => {
      const docs = await fetchDocuments(id);
      setDocuments(docs);
    },
    [fetchDocuments],
  );

  const stopIndexingPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
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
        stopIndexingPoll();
        setUploadPhase("idle");
        setReindexingId(null);
      }
    };
    void run();
    pollTimerRef.current = setInterval(() => void run(), 1800);
  }, [kbId, fetchDocuments, stopIndexingPoll]);

  const reindexDoc = useCallback(
    async (documentId: string) => {
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
    },
    [kbId, loadDocuments, startIndexingPoll, pushToast],
  );

  const deleteDoc = useCallback(
    async (documentId: string, title: string) => {
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
      } catch {
        pushToast("Error de red al eliminar", "error");
      } finally {
        setDeletingId(null);
      }
    },
    [kbId, loadDocuments, pushToast],
  );

  const runUpload = useCallback(
    async (file: File) => {
      if (!file || !kbId) return;
      setUploadPhase("uploading");
      try {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("knowledgeBaseId", kbId);
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
    },
    [kbId, loadDocuments, startIndexingPoll, pushToast],
  );

  useEffect(() => {
    startTransition(() => {
      void loadKnowledgeBases();
    });
  }, [loadKnowledgeBases]);

  useEffect(() => {
    if (!preferredKbId) {
      appliedPreferredRef.current = null;
      return;
    }
    if (!knowledgeBases.length) return;
    if (!knowledgeBases.some((k) => k.id === preferredKbId)) return;
    if (appliedPreferredRef.current === preferredKbId) return;
    setKbId(preferredKbId);
    appliedPreferredRef.current = preferredKbId;
  }, [knowledgeBases, preferredKbId]);

  useEffect(() => {
    stopIndexingPoll();
    startTransition(() => {
      setUploadPhase("idle");
      setReindexingId(null);
      setDeletingId(null);
      void loadDocuments(kbId);
    });
  }, [kbId, loadDocuments, stopIndexingPoll]);

  useEffect(() => () => stopIndexingPoll(), [stopIndexingPoll]);

  const indexingBusy =
    uploadPhase !== "idle" || documents.some((d) => d.status === "pending" || d.status === "processing");

  return {
    knowledgeBases,
    kbId,
    setKbId,
    loadingKb,
    documents,
    uploadPhase,
    indexingBusy,
    reindexingId,
    deletingId,
    runUpload,
    reindexDoc,
    deleteDoc,
    toast,
    dismissToast: () => setToast(null),
    pushToast,
  };
}
