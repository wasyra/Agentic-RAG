import { SettingsForm } from "@/components/settings-form";
import {
  AgenticAppPageShell,
  AgenticStudioBackLink,
} from "@/components/agentic/agentic-app-page-shell";
import { Card, CardContent, CardDescription, CardHeader } from "@vetaui/atoms";
import { Heading, Text, VStack } from "@vetaui/templates";

export default function SettingsPage() {
  return (
    <AgenticAppPageShell>
      <AgenticStudioBackLink />

      <div data-readme-ready className="min-w-0">
        <VStack gap={8}>
        <Card variant="ghost" className="border-0 bg-transparent p-0 shadow-none">
          <CardHeader className="p-0">
            <Text variant="overline" tone="muted" weight="semibold" className="mb-2 tracking-[0.2em]">
              Preferencias del modelo
            </Text>
            <Heading as="h1" size="3xl" weight="semibold" className="text-[var(--veta-fg)]">
              Configuración de IA
            </Heading>
            <CardDescription className="mt-4 max-w-xl text-base leading-relaxed text-[var(--veta-fg-muted)]">
              Elige <strong className="font-medium text-[var(--veta-fg)]">OpenAI o Google</strong>: una sola API key para
              chat y embeddings. Con el proxy activo la clave va en cookie httpOnly; si no, en localStorage. El modelo se
              guarda en{" "}
              <span className="font-mono rounded-md border border-[var(--veta-border-soft)] bg-[var(--veta-bg-subtle)] px-1.5 py-0.5 text-xs text-[var(--veta-primary)]">
                app-settings.json
              </span>{" "}
              vía FastAPI.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card variant="elevated" className="agentic-glass-panel rounded-2xl border-[var(--veta-border-soft)] shadow-2xl sm:rounded-3xl">
          <CardContent className="min-w-0 p-4 sm:p-8 lg:p-10">
            <SettingsForm />
          </CardContent>
        </Card>
        </VStack>
      </div>
    </AgenticAppPageShell>
  );
}
