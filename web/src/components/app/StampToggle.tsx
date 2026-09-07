"use client";

import { Stamp } from "lucide-react";
import { cn } from "@/lib/utils";

interface StampToggleProps {
  used: boolean;
  onToggle: () => void;
  className?: string;
  /** Compact variant for dense rows (e.g. upscale entries). */
  small?: boolean;
  /** Optional accessible name (defaults to the title attribute). */
  label?: string;
  /** Disable while a request is in flight (per-platform stamps). */
  busy?: boolean;
}

/**
 * The signature control — a rubber-stamp style mark/unmark button for the
 * "used" flag (image already published/consumed on its destination
 * platform). Used on image cards with the any-platform view, and inside the
 * detail dialog per stock platform.
 */
export function StampToggle({ used, onToggle, className, small = false, label, busy = false }: StampToggleProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onToggle();
      }}
      aria-pressed={used}
      aria-label={label}
      disabled={busy}
      className={cn(
        "flex items-center border-2 font-display font-bold uppercase tracking-widest transition-all focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60",
        small ? "gap-1 px-2 py-1 text-[10.5px]" : "gap-2 px-3.5 py-1.5 text-xs",
        used
          ? "border-stamp bg-stamp-soft text-stamp hover:bg-stamp hover:text-white"
          : "border-ink/25 bg-surface text-ink-muted hover:border-stamp hover:text-stamp",
        className
      )}
      title={used ? "Already used (published) — click to unmark" : "Mark as used (published)"}
    >
      <Stamp className={small ? "h-3 w-3" : "h-4 w-4"} aria-hidden />
      {busy ? "…" : used ? "Used" : "Mark used"}
    </button>
  );
}
