"use client";

import { useSearchParams } from "next/navigation";
import { cn } from "@vetaui/foundations";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  ScrollArea,
  Spinner,
} from "@vetaui/atoms";
import { EmptyState, FileDropzone, FormField } from "@vetaui/molecules";
import { KnowledgeBaseDisplay } from "@/components/agentic/knowledge-base-display";
import { useKnowledgeBaseLibrary } from "@/hooks/use-knowledge-base-library";
import {
  documentStatusBadgeVariant,
  documentStatusLabel,
  formatDocError,
} from "@/lib/document-status";
import { RefreshCw, Trash2, Upload } from "lucide-react";

export function IndexingStudioPanel() {
  const searchParams = useSearchParams();
  const kbFromUrl = searchParams.get("kb");
  const preferredKbId = kbFromUrl ?? undefined;
  const lib = useKnowledgeBaseLibrary({ preferredKbId });

  const {
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
    dismissToast,
    pushToast,
  } = lib;

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 sm:gap-5">
      {toast && (
        <Alert variant={toast.tone === "error" ? "danger" : "info"} className="border-[var(--veta-border-soft)] shadow-md">
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="leading-relaxed">{toast.message}</span>
            <Button type="button" variant="ghost" size="sm" className="agentic-tap shrink-0 self-end sm:self-auto" onClick={dismissToast}>
              Cerrar
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card variant="elevated" className="agentic-glass-panel rounded-2xl border-[var(--veta-border-soft)] shadow-md ring-1 ring-[color-mix(in_oklch,var(--veta-border)_35%,transparent)] sm:rounded-3xl">
        <CardHeader className="space-y-1 px-4 pt-5 sm:px-6 sm:pt-6">
          <CardTitle className="text-sm font-medium text-[var(--veta-fg)]">
            {knowledgeBases.length === 1 ? "Tu biblioteca personal" : "Base de conocimiento"}
          </CardTitle>
          <CardDescription className="text-xs text-[var(--veta-fg-muted)]">
            {knowledgeBases.length === 1
              ? "Un solo espacio: todo lo que subas queda indexado aquí para el chat del estudio."
              : "Elige la base donde se guardan los archivos. El estudio usa la misma selección al volver."}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-5 px-4 pb-6 pt-0 sm:px-6 sm:pb-7">
          <KnowledgeBaseDisplay
            knowledgeBases={knowledgeBases}
            value={kbId}
            onValueChange={setKbId}
            loading={loadingKb}
            instanceId="indexar-panel"
            size="page"
          />

          <FormField
            id="indexar-file-upload"
            label={
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--veta-fg-muted)]">
                Subir archivos
              </span>
            }
            description="PDF, TXT o Markdown. También puedes arrastrar aquí."
            className="min-w-0 gap-1.5"
          >
            <FileDropzone
              accept=".pdf,.txt,.md"
              multiple={false}
              disabled={!kbId || uploadPhase !== "idle"}
              maxFiles={1}
              className={cn(
                "w-full min-w-0 overflow-hidden !p-4 sm:!p-5",
                "min-h-[4.25rem] gap-2 border-2 border-dashed text-center transition-all duration-300 sm:min-h-[3.75rem]",
                "rounded-2xl border-[var(--veta-border)] bg-[color-mix(in_oklch,var(--veta-bg-subtle)_88%,transparent)]",
                "shadow-[inset_0_1px_0_color-mix(in_oklch,var(--veta-fg)_6%,transparent)] ring-1 ring-[color-mix(in_oklch,var(--veta-border)_40%,transparent)]",
                "hover:border-[var(--veta-primary)] hover:bg-[var(--veta-primary-subtle)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--veta-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--veta-bg)]",
                uploadPhase !== "idle" && "cursor-wait border-[var(--veta-primary)] bg-[var(--veta-primary-subtle)]",
              )}
              onFilesAdded={(files) => {
                const f = files[0];
                if (f) void runUpload(f);
              }}
              onError={() => pushToast("No se pudo aceptar el archivo (tamaño o cantidad).", "error")}
            >
              <div className="flex w-full min-w-0 flex-col items-center justify-center gap-2.5 text-balance sm:flex-row sm:gap-3">
                {uploadPhase !== "idle" ? (
                  <Spinner size="sm" />
                ) : (
                  <Upload className="size-5 shrink-0 text-[var(--veta-primary)]" aria-hidden />
                )}
                <span className="w-full min-w-0 px-0.5 text-center text-sm font-medium leading-snug text-[var(--veta-fg)] sm:text-left">
                  {uploadPhase === "uploading" ? "Subiendo…" : uploadPhase === "indexing" ? "Indexando…" : "Toca o arrastra un PDF o texto"}
                </span>
              </div>
            </FileDropzone>
          </FormField>
        </CardContent>
      </Card>

      <Card variant="elevated" className="agentic-glass-panel flex min-h-0 flex-1 flex-col rounded-2xl border-[var(--veta-border-soft)] shadow-md ring-1 ring-[color-mix(in_oklch,var(--veta-border)_35%,transparent)] sm:rounded-3xl">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 px-4 pt-5 sm:px-6 sm:pt-6">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-sm font-medium text-[var(--veta-fg)]">Archivos indexados</CardTitle>
            <CardDescription className="text-xs text-[var(--veta-fg-muted)]">
              Estado, reindexación y eliminación por documento.
            </CardDescription>
          </div>
          {indexingBusy && (
            <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--veta-accent)]">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--veta-accent)] opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-[var(--veta-accent)]" />
              </span>
              Procesando
            </span>
          )}
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col px-4 pb-6 pt-0 sm:px-6 sm:pb-8">
          {indexingBusy && (
            <div className="mb-4">
              <Progress value={50} className="h-1 rounded-full" />
            </div>
          )}
          {!kbId ? (
            <EmptyState
              className="mt-1 rounded-2xl border border-dashed border-[var(--veta-border-soft)] bg-[color-mix(in_oklch,var(--veta-surface-elevated)_65%,transparent)] py-12 shadow-none"
              icon={<Upload className="text-[var(--veta-primary)]" aria-hidden />}
              title="Elige una base"
              description="Selecciona arriba una base de conocimiento para ver y subir archivos."
            />
          ) : documents.length === 0 ? (
            <EmptyState
              className="mt-1 rounded-2xl border border-dashed border-[var(--veta-border-soft)] bg-[color-mix(in_oklch,var(--veta-surface-elevated)_65%,transparent)] py-12 shadow-none"
              icon={<Upload className="text-[var(--veta-primary)]" aria-hidden />}
              title="Ningún documento"
              description="Sube PDF o texto para indexarlo en esta base."
            />
          ) : (
            <ScrollArea className="min-h-[min(52dvh,28rem)] w-full pr-3 sm:min-h-[min(58dvh,32rem)]">
              <ul className="space-y-3 pb-2">
                {documents.map((d) => {
                  const badgeVariant = documentStatusBadgeVariant(d.status);
                  const statusLabel = documentStatusLabel(d.status);
                  const rowBusy =
                    d.status === "pending" ||
                    d.status === "processing" ||
                    reindexingId === d.id ||
                    deletingId === d.id;
                  return (
                    <li key={d.id}>
                      <Card variant="interactive" className="rounded-2xl border-[var(--veta-border-soft)] p-4 shadow-sm sm:p-5">
                        <div className="flex items-start gap-3">
                          {rowBusy ? <Spinner size="sm" className="mt-1 shrink-0" /> : null}
                          <div className="min-w-0 flex-1">
                            <div
                              className="text-sm font-semibold leading-snug tracking-tight text-[var(--veta-fg)] break-words [overflow-wrap:anywhere] sm:text-[15px]"
                              title={d.title}
                            >
                              {d.title}
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <Badge variant={badgeVariant} emphasis="subtle" size="sm">
                                {statusLabel}
                              </Badge>
                              {d.status !== "processing" && (
                                <>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="agentic-tap h-auto gap-1.5 rounded-2xl px-3 py-2 text-xs sm:h-9 sm:min-h-0 sm:text-sm"
                                    disabled={uploadPhase !== "idle" || reindexingId !== null || deletingId !== null}
                                    onClick={() => void reindexDoc(d.id)}
                                  >
                                    <RefreshCw className="size-3.5 shrink-0" aria-hidden />
                                    {reindexingId === d.id ? "…" : "Reindexar"}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="agentic-tap h-auto gap-1.5 rounded-2xl px-3 py-2 text-xs text-[var(--veta-danger)] hover:border-[var(--veta-danger)] hover:bg-[var(--veta-danger-subtle)] sm:h-9 sm:min-h-0 sm:text-sm"
                                    disabled={uploadPhase !== "idle" || reindexingId !== null || deletingId !== null}
                                    onClick={() => void deleteDoc(d.id, d.title)}
                                  >
                                    <Trash2 className="size-3.5 shrink-0" aria-hidden />
                                    {deletingId === d.id ? "…" : "Eliminar"}
                                  </Button>
                                </>
                              )}
                            </div>
                            {d.statusMessage && (
                              <p className="mt-3 max-h-24 overflow-y-auto break-words text-xs leading-relaxed text-[var(--veta-warning)]">
                                {formatDocError(d.statusMessage)}
                              </p>
                            )}
                          </div>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
