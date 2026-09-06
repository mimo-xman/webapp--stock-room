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
}

/**
 * The signature control — a rubber-stamp style mark/unmark button for the
 * generic "used" flag (image already published/consumed on its destination
 * platform). The API field is historically named `used_in_adobe_stock` (wire
 * contract) but the concept is platform-agnostic.
 */
export function StampToggle({ used, onToggle, className, small = false, label }: StampToggleProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={used}
      aria-label={label}
      className={cn(
        "flex items-center border-2 font-display font-bold uppercase tracking-widest transition-all focus-visible:outline-2 focus-visible:outline-brand",
        small ? "gap-1 px-2 py-1 text-[10.5px]" : "gap-2 px-3.5 py-1.5 text-xs",
        used
          ? "border-stamp bg-stamp-soft text-stamp hover:bg-stamp hover:text-white"
          : "border-ink/25 bg-surface text-ink-muted hover:border-stamp hover:text-stamp",
        className
      )}
      title={used ? "Already used (published) — click to unmark" : "Mark as used (published)"}
    >
      <Stamp className={small ? "h-3 w-3" : "h-4 w-4"} aria-hidden />
      {used ? "Used" : "Mark used"}
    </button>
  );
}
