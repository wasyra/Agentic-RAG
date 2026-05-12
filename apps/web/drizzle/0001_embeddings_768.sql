DROP INDEX IF EXISTS "chunks_embedding_hnsw";--> statement-breakpoint
DELETE FROM "chunks";--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(768);--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw" ON "chunks" USING hnsw ("embedding" vector_cosine_ops) WHERE "chunks"."embedding" IS NOT NULL;
