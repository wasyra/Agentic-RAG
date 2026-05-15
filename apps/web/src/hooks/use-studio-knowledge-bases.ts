"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { apiUrl } from "@/lib/api-url";

type KnowledgeBaseRow = { id: string; name: string; createdAt: string };

export function useStudioKnowledgeBases() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseRow[]>([]);
  const [kbId, setKbId] = useState<string>("");
  const [loadingKb, setLoadingKb] = useState(true);

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

  useEffect(() => {
    startTransition(() => {
      void loadKnowledgeBases();
    });
  }, [loadKnowledgeBases]);

  return { knowledgeBases, kbId, setKbId, loadingKb };
}
