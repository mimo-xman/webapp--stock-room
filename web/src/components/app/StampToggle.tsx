"use client";

import { Stamp } from "lucide-react";
import { cn } from "@/lib/utils";

interface StampToggleProps {
  used: boolean;
  onToggle: () => void;
  className?: string;
}

/**
 * The signature control — a rubber-stamp style mark/unmark button
 * for "used in Adobe Stock".
 */
export function StampToggle({ used, onToggle, className }: StampToggleProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={used}
      className={cn(
        "flex items-center gap-2 border-2 px-3.5 py-1.5 font-display text-xs font-bold uppercase tracking-widest transition-all focus-visible:outline-2 focus-visible:outline-brand",
        used
          ? "border-stamp bg-stamp-soft text-stamp hover:bg-stamp hover:text-white"
          : "border-ink/25 bg-surface text-ink-muted hover:border-stamp hover:text-stamp",
        className
      )}
      title={used ? "Marked as used in Adobe Stock — click to unmark" : "Mark as used in Adobe Stock"}
    >
      <Stamp className="h-4 w-4" aria-hidden />
      {used ? "Used" : "Mark used"}
    </button>
  );
}
