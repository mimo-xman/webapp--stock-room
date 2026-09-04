"use client";

/**
 * Sticky bottom bar shown while at least one asset (original or upscale
 * variant) is selected for the Adobe Stock CSV export. See docs/CSV_EXPORT.md.
 */

import { CheckSquare, FileDown, X } from "lucide-react";

interface SelectionBarProps {
  count: number;
  disabled?: boolean;
  onDownload: () => void;
  onClear: () => void;
}

export function SelectionBar({ count, disabled = false, onDownload, onClear }: SelectionBarProps) {
  if (count === 0) return null;

  return (
    <div
      className="sticky bottom-4 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-3 border border-ink bg-surface px-4 py-3 shadow-[var(--shadow-hard)]"
      role="status"
      aria-live="polite"
      data-testid="selection-bar"
    >
      <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-ink">
        <CheckSquare className="h-4 w-4 text-brand" aria-hidden />
        {count} selected for Adobe Stock CSV
      </span>
      <span className="hidden font-mono text-[10.5px] text-ink-muted sm:inline">
        (selection is kept when you change pages)
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onClear}
          className="flex h-9 items-center gap-1.5 border border-line-strong bg-surface px-3 font-display text-xs font-semibold uppercase tracking-widest text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-brand"
          aria-label="Clear the selection"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Clear
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={disabled}
          className="flex h-9 items-center gap-2 bg-brand px-4 font-display text-xs font-bold uppercase tracking-widest text-white shadow-[var(--shadow-hard-sm)] transition-colors hover:bg-brand-deep disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-brand"
          aria-label="Download the Adobe Stock CSV file"
          data-testid="download-csv"
        >
          <FileDown className="h-4 w-4" aria-hidden />
          {disabled ? "Building…" : "Download CSV"}
        </button>
      </div>
    </div>
  );
}
