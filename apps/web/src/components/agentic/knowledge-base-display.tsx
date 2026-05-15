"use client";

import {
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@vetaui/atoms";

export type KnowledgeBaseOption = { id: string; name: string };

type KnowledgeBaseDisplayProps = {
  knowledgeBases: KnowledgeBaseOption[];
  value: string;
  onValueChange: (id: string) => void;
  loading: boolean;
  /** a11y: unique id prefix for trigger */
  instanceId: string;
  /** Wider select trigger padding (indexar page) */
  size?: "sidebar" | "page";
};

/**
 * When there is exactly one knowledge base, shows a static row (no fake “dropdown”).
 * Multiple bases → Radix Select unchanged.
 */
export function KnowledgeBaseDisplay({
  knowledgeBases,
  value,
  onValueChange,
  loading,
  instanceId,
  size = "sidebar",
}: KnowledgeBaseDisplayProps) {
  const triggerPad = size === "page" ? "px-4 py-3 sm:min-h-11" : "px-3 py-2.5 sm:min-h-10";

  if (loading && knowledgeBases.length === 0) {
    return <Skeleton className="h-12 w-full rounded-2xl" shape="rounded" />;
  }

  if (knowledgeBases.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--veta-border-soft)] bg-[color-mix(in_oklch,var(--veta-bg-subtle)_80%,transparent)] px-4 py-3 text-center text-sm text-[var(--veta-fg-muted)]">
        No hay bases. Ejecuta <span className="font-mono text-[var(--veta-fg-subtle)]">npm run db:seed</span>.
      </div>
    );
  }

  if (knowledgeBases.length === 1) {
    const kb = knowledgeBases[0];
    return (
      <div
        className={`flex min-h-[3rem] w-full min-w-0 items-center justify-between gap-3 rounded-2xl border border-[var(--veta-border-soft)] bg-[color-mix(in_oklch,var(--veta-bg-subtle)_75%,transparent)] ${triggerPad} shadow-sm backdrop-blur-sm`}
        role="status"
        aria-label={`Base de conocimiento: ${kb.name}`}
      >
        <p className="min-w-0 truncate text-sm font-semibold text-[var(--veta-fg)] sm:text-base">{kb.name}</p>
        <Badge variant="brand" emphasis="subtle" size="sm" className="shrink-0 tabular-nums">
          Personal
        </Badge>
      </div>
    );
  }

  return (
    <Select
      value={knowledgeBases.some((k) => k.id === value) ? value : undefined}
      onValueChange={onValueChange}
      disabled={loading || knowledgeBases.length === 0}
    >
      <SelectTrigger
        className={`min-h-11 w-full min-w-0 rounded-2xl text-left text-sm shadow-sm [&>span]:line-clamp-1 [&>span]:min-w-0 [&>span]:text-[var(--veta-fg)] ${triggerPad}`}
        aria-label="Base de conocimiento activa"
        id={`${instanceId}-kb-select`}
      >
        <SelectValue placeholder={loading ? "Cargando…" : "Seleccionar base"} />
      </SelectTrigger>
      <SelectContent
        position="item-aligned"
        className="z-[200] max-h-[min(50vh,20rem)] overflow-y-auto shadow-2xl"
      >
        {knowledgeBases.map((kb) => (
          <SelectItem key={kb.id} value={kb.id} className="cursor-pointer rounded-xl py-2.5">
            {kb.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
