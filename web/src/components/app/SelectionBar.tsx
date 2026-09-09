"use client";

/**
 * Sticky bottom bar shown while at least one asset (original or upscale
 * variant) is selected. The same selection feeds both actions:
 *
 *   · Mark N as used — the bulk stamp (one request, see POST
 *     /api/images/bulk-used): originals mark their image, upscales mark
 *     their variant, exactly like each item's own toggle.
 *   · Download CSV  — the Adobe Stock contributor export
 *     (see docs/CSV_EXPORT.md).
 */

import { CheckSquare, FileDown, Stamp, X } from "lucide-react";

interface SelectionBarProps {
  count: number;
  disabled?: boolean;
  /** Bulk stamp in flight ("Marking…" state). */
  marking?: boolean;
  onMarkUsed: () => void;
  onDownload: () => void;
  onClear: () => void;
}

export function SelectionBar({ count, disabled = false, marking = false, onMarkUsed, onDownload, onClear }: SelectionBarProps) {
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
        {count} selected
      </span>
      <span className="hidden font-mono text-[10.5px] text-ink-muted sm:inline">
        (selection is kept when you change pages)
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
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
          className="flex h-9 items-center gap-2 border border-brand/50 bg-surface px-4 font-display text-xs font-bold uppercase tracking-widest text-brand transition-colors hover:border-brand hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60"
          aria-label="Download the CSV file"
          data-testid="download-csv"
        >
          <FileDown className="h-4 w-4" aria-hidden />
          {disabled ? "Building…" : "Download CSV"}
        </button>
        <button
          type="button"
          onClick={onMarkUsed}
          disabled={marking}
          className="flex h-9 items-center gap-2 bg-brand px-4 font-display text-xs font-bold uppercase tracking-widest text-white shadow-[var(--shadow-hard-sm)] transition-colors hover:bg-brand-deep focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60"
          aria-label={`Mark the ${count} selected asset${count === 1 ? "" : "s"} as used`}
          data-testid="mark-used-bulk"
        >
          <Stamp className="h-4 w-4" aria-hidden />
          {marking ? "Marking…" : `Mark ${count} as used`}
        </button>
      </div>
    </div>
  );
}
