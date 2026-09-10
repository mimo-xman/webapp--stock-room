"use client";

/**
 * Sticky bottom bar shown while at least one asset (original or upscale
 * variant) is selected. The same selection feeds three actions:
 *
 *   · Mark N as used   — opens the platform picker popup (BulkUsedDialog):
 *     the owner checks the marketplaces where the batch is published, then
 *     ONE request stamps every selected ORIGIN image on those platforms.
 *   · Unmark N as used — same popup in unmark mode (or "Clear everything"):
 *     bulk unmark instead of one image at a time.
 *   · Download CSV     — the Adobe Stock contributor export
 *     (see docs/CSV_EXPORT.md) — this one DOES use the upscales in the
 *     selection (each variant becomes its own CSV row).
 *
 * Upscale variants have no used state of their own: they follow their
 * original image. So both stamp buttons act on the ORIGIN images only —
 * when the selection holds only upscales, the buttons are disabled and the
 * bar explains why.
 */

import { CheckSquare, FileDown, ListX, Stamp, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectionBarProps {
  /** Total selected assets (origins + upscales). */
  count: number;
  /** Selected ORIGIN images — the only targets of the mark/unmark stamps. */
  originCount: number;
  disabled?: boolean;
  /** Bulk stamp request in flight ("Stamping…" state — mark or unmark). */
  busy?: boolean;
  /** Opens the platform picker popup (mark mode). */
  onMarkUsed: () => void;
  /** Opens the platform picker popup (unmark mode). */
  onUnmarkUsed: () => void;
  onDownload: () => void;
  onClear: () => void;
}

export function SelectionBar({
  count,
  originCount,
  disabled = false,
  busy = false,
  onMarkUsed,
  onUnmarkUsed,
  onDownload,
  onClear,
}: SelectionBarProps) {
  if (count === 0) return null;

  const upscaleCount = count - originCount;
  // Only upscales selected: the stamps cannot act (upscales follow their
  // original image) — say it clearly instead of failing silently.
  const onlyUpscales = originCount === 0;

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
        ({originCount} original{originCount === 1 ? "" : "s"} · {upscaleCount} upscale{upscaleCount === 1 ? "" : "s"})
      </span>
      <span className="hidden font-mono text-[10.5px] text-ink-muted sm:inline">
        · selection is kept when you change pages
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
          onClick={onUnmarkUsed}
          disabled={busy || onlyUpscales}
          className={cn(
            "flex h-9 items-center gap-2 border-2 border-danger/60 bg-surface px-3 font-display text-xs font-bold uppercase tracking-widest text-danger transition-colors hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60",
          )}
          aria-label={`Unmark the ${originCount} selected image${originCount === 1 ? "" : "s"} as used (choose the platforms)`}
          title={
            onlyUpscales
              ? "Only upscales are selected — unmark applies to origin images (upscales follow their original)"
              : "Bulk unmark — choose the platforms to clear"
          }
          data-testid="unmark-used-bulk"
        >
          <ListX className="h-4 w-4" aria-hidden />
          Unmark {originCount} as used
        </button>
        <button
          type="button"
          onClick={onMarkUsed}
          disabled={busy || onlyUpscales}
          className="flex h-9 items-center gap-2 bg-brand px-4 font-display text-xs font-bold uppercase tracking-widest text-white shadow-[var(--shadow-hard-sm)] transition-colors hover:bg-brand-deep focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60"
          aria-label={`Mark the ${originCount} selected image${originCount === 1 ? "" : "s"} as used (choose the platforms)`}
          title={
            onlyUpscales
              ? "Only upscales are selected — mark applies to origin images (upscales follow their original)"
              : "Bulk mark — choose the platforms where the batch is published"
          }
          data-testid="mark-used-bulk"
        >
          <Stamp className="h-4 w-4" aria-hidden />
          {busy ? "Stamping…" : `Mark ${originCount} as used`}
        </button>
      </div>

      {onlyUpscales && (
        <p
          className="w-full font-mono text-[10.5px] leading-relaxed text-ink-muted"
          data-testid="only-upscales-note"
        >
          Only upscale variants are selected — mark / unmark as used applies to origin images:
          an upscale is the same image as its original, so it follows the original&apos;s used
          state on every platform. Use the CSV export for the selected upscales, or select
          origin images to stamp them.
        </p>
      )}
    </div>
  );
}
