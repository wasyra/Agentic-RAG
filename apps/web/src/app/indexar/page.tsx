import { Suspense } from "react";
import { Card, CardDescription, CardHeader, Spinner } from "@vetaui/atoms";
import { Heading, Text, VStack } from "@vetaui/templates";
import {
  AgenticAppPageShell,
  AgenticStudioBackLink,
} from "@/components/agentic/agentic-app-page-shell";
import { IndexingStudioPanel } from "@/components/indexing-studio-panel";

function IndexingFallback() {
  return (
    <div className="flex justify-center py-20" aria-busy="true" aria-label="Cargando indexación">
      <Spinner size="lg" />
    </div>
  );
}

export default function IndexarPage() {
  return (
    <AgenticAppPageShell containerSize="lg">
      <AgenticStudioBackLink />

      <VStack gap={8}>
        <Card variant="ghost" className="border-0 bg-transparent p-0 shadow-none">
          <CardHeader className="p-0">
            <Text variant="overline" tone="muted" weight="semibold" className="mb-2 tracking-[0.2em]">
              Biblioteca · RAG
            </Text>
            <Heading as="h1" size="3xl" weight="semibold" className="text-[var(--veta-fg)]">
              Indexar conocimiento
            </Heading>
            <CardDescription className="mt-4 max-w-2xl text-base leading-relaxed text-[var(--veta-fg-muted)]">
              Sube y gestiona documentos con el mismo estilo que{" "}
              <strong className="font-medium text-[var(--veta-fg)]">Ajustes de IA</strong>: tarjetas claras, controles táctiles
              y anchura fluida en cualquier zoom o dispositivo.
            </CardDescription>
          </CardHeader>
        </Card>

        <div className="min-w-0">
          <Suspense fallback={<IndexingFallback />}>
            <IndexingStudioPanel />
          </Suspense>
        </div>
      </VStack>
    </AgenticAppPageShell>
  );
}
