/**
 * Dimensión única de la columna pgvector: OpenAI (text-embedding-3-small con
 * `dimensions: 768`) y Google (gemini-embedding-001 + outputDimensionality 768).
 */
export const EMBEDDING_DIMENSIONS = 768 as const;
