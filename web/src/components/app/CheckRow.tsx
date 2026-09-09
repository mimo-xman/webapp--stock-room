"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CheckRowProps {
  checked: boolean;
  onToggle: () => void;
  label: string;
  /** Item count shown in the trailing chip (omit when not a list). */
  count?: number;
  /** Chip suffix after the count, e.g. "on this page". */
  countLabel?: string;
  hint?: string;
  disabled?: boolean;
  testId?: string;
}

/**
 * A checkbox row in the app's square-cornered style (the same look as the
 * per-image select button) — used by the Select all / Deselect all panel
 * and the Etsy ZIP popup. The parent decides the default state: both new
 * panels start with NOTHING checked, the owner picks exactly what goes in.
 */
export function CheckRow({
  checked,
  onToggle,
  label,
  count,
  countLabel,
  hint,
  disabled = false,
  testId,
}: CheckRowProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-brand",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-paper"
      )}
      data-testid={testId}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center border transition-colors",
          checked ? "border-brand bg-brand text-white" : "border-line-strong bg-surface text-transparent"
        )}
      >
        <Check className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug">{label}</span>
        {hint && <span className="mt-0.5 block font-mono text-[10.5px] leading-snug text-ink-muted">{hint}</span>}
      </span>
      {typeof count === "number" && (
        <span className="chip shrink-0 border-line-strong">
          {count}
          {countLabel ? ` ${countLabel}` : ""}
        </span>
      )}
    </button>
  );
}
