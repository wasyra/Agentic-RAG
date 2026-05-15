"use client";

import { cn } from "@vetaui/foundations";

/** Premium ambient layer for chat shell — zero runtime logic */
export function AgenticAurora({ className }: { className?: string }) {
  return (
    <div className={cn("agentic-aurora", className)} aria-hidden>
      <div className="agentic-aurora__blob agentic-aurora__blob--a" />
      <div className="agentic-aurora__blob agentic-aurora__blob--b" />
      <div className="agentic-aurora__blob agentic-aurora__blob--c" />
    </div>
  );
}
