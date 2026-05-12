export type Citation = {
  chunkId: string;
  documentId: string;
  title: string;
  page: number | null;
  excerpt: string;
};

export type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
};
