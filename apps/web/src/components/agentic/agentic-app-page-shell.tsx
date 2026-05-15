import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@vetaui/atoms";
import { Container } from "@vetaui/templates";

export function AgenticPageBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
      <div
        className="absolute left-1/2 top-0 h-[min(32rem,70vw)] w-[min(40rem,92vw)] -translate-x-1/2 -translate-y-1/3 rounded-full blur-3xl"
        style={{
          background: "color-mix(in oklch, var(--veta-primary), transparent 78%)",
        }}
      />
      <div
        className="absolute bottom-0 right-0 h-[min(24rem,55vw)] w-[min(24rem,70vw)] translate-x-1/4 translate-y-1/4 rounded-full blur-3xl"
        style={{
          background: "color-mix(in oklch, var(--veta-accent), transparent 84%)",
        }}
      />
    </div>
  );
}

type AgenticAppPageShellProps = {
  children: React.ReactNode;
  /** Max width token: matches settings (`md` ≈ readable column). */
  containerSize?: "md" | "lg";
  className?: string;
};

/**
 * Shared full-page frame for settings, indexación, and similar flows:
 * fluid padding, safe areas, capped content width for legibility at 100% zoom.
 */
export function AgenticAppPageShell({ children, containerSize = "md", className }: AgenticAppPageShellProps) {
  return (
    <div
      className={
        "agentic-app-page-shell relative min-h-dvh w-full min-w-0 max-w-[100dvw] overflow-x-hidden text-[var(--veta-fg)] " +
        "px-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(3rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] " +
        "sm:px-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))] sm:pb-16 sm:pt-8 lg:px-[max(1.75rem,env(safe-area-inset-left))] lg:pr-[max(1.75rem,env(safe-area-inset-right))] lg:pt-12 " +
        (className ?? "")
      }
    >
      <AgenticPageBackdrop />
      <Container
        size={containerSize}
        className="relative mx-auto w-full min-w-0 max-w-full px-0 sm:max-w-[min(42rem,calc(100vw-2rem))] lg:max-w-[min(56rem,calc(100vw-3rem))]"
      >
        {children}
      </Container>
    </div>
  );
}

/** Shared with header actions, sidebar CTAs, etc. — same “pill-rectangle” as Volver al estudio. */
export const AGENTIC_CTA_OUTLINE_CLASS =
  "agentic-cta-interactive rounded-2xl border-[var(--veta-border-soft)] bg-[color-mix(in_oklch,var(--veta-bg-subtle)_55%,transparent)] font-semibold shadow-sm backdrop-blur-sm transition-colors hover:border-[color-mix(in_oklch,var(--veta-primary)_45%,var(--veta-border))] hover:bg-[color-mix(in_oklch,var(--veta-primary-subtle)_70%,transparent)]";

type AgenticStudioBackLinkProps = {
  href?: string;
};

export function AgenticStudioBackLink({ href = "/" }: AgenticStudioBackLinkProps) {
  return (
    <Button
      variant="outline"
      size="lg"
      asChild
      className={`agentic-studio-back agentic-tap mb-6 h-auto min-h-[3rem] w-full max-w-full gap-2.5 px-5 py-3 text-base text-[var(--veta-fg)] sm:mb-8 sm:w-auto sm:min-w-[12rem] sm:max-w-none ${AGENTIC_CTA_OUTLINE_CLASS}`}
    >
      <Link href={href} className="inline-flex w-full items-center justify-center gap-2.5 sm:w-auto sm:justify-start">
        <ArrowLeft className="size-5 shrink-0 opacity-90" aria-hidden />
        Volver al estudio
      </Link>
    </Button>
  );
}
