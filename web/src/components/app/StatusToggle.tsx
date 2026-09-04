"use client";

import { Power } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatusToggleProps {
  active: boolean;
  disabled?: boolean;
  onToggle: () => void;
  className?: string;
  /** Optional accessible name. */
  label?: string;
}

/**
 * Batch-status control — toggles an image between Active (eligible for the
 * parallel upscale workers) and Paused (excluded, e.g. after a hard failure).
 */
export function StatusToggle({ active, disabled = false, onToggle, className, label }: StatusToggleProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "flex items-center gap-2 border-2 px-3.5 py-1.5 font-display text-xs font-bold uppercase tracking-widest transition-all focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60",
        active
          ? "border-ink/25 bg-surface text-ink-muted hover:border-ink hover:text-ink"
          : "border-danger bg-danger-soft text-danger hover:bg-danger hover:text-white",
        className
      )}
      title={
        active
          ? "Active — the batch workers can pick this image. Click to pause it."
          : "Paused — excluded from every batch run (e.g. after a failure). Click to reactivate."
      }
      data-testid="status-toggle"
    >
      <Power className="h-4 w-4" aria-hidden />
      {active ? "Active" : "Paused"}
    </button>
  );
}
