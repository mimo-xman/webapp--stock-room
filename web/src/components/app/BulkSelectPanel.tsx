"use client";

/**
 * Select all / Deselect all — the page-scoped bulk selection bar shown above
 * the image grids of /images and /sessions/:id.
 *
 * Clicking either button REVEALS the category panel (nothing checked by
 * default, per the owner's spec):
 *
 *   [] origin images
 *   [] upscale images (x2)
 *   [] upscale images (x4)
 *
 * Apply adds (or removes) those categories for every image of the CURRENT
 * page. The selection map lives in the page component and survives
 * pagination, so the owner can select all on page 1, continue to page 2 and
 * keep accumulating — deselecting works the same way, page by page, plus a
 * "clear everything" escape hatch in the deselect panel.
 */

import { useState } from "react";
import { ListChecks, ListX, X } from "lucide-react";
import { CheckRow } from "./CheckRow";
import type { StockImage } from "@/lib/types";
import type { SelectionCategory } from "@/hooks/use-csv-selection";
import { cn } from "@/lib/utils";

interface BulkSelectPanelProps {
  /** Images of the CURRENT page (the panel is page-scoped by design). */
  images: StockImage[];
  page: number;
  onApply: (categories: SelectionCategory[], mode: "add" | "remove") => void;
  /** Wipe the entire selection across all pages. */
  onClearAll: () => void;
}

const smallButton =
  "flex h-9 items-center gap-1.5 border border-line-strong bg-surface px-3 font-display text-xs font-semibold uppercase tracking-widest text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-brand";

export function BulkSelectPanel({ images, page, onApply, onClearAll }: BulkSelectPanelProps) {
  const [mode, setMode] = useState<"select" | "deselect" | null>(null);
  const [cats, setCats] = useState<Record<SelectionCategory, boolean>>({
    origin: false,
    x2: false,
    x4: false,
  });

  function open(next: "select" | "deselect") {
    setMode((prev) => (prev === next ? null : next));
    // fresh panel every time — nothing checked by default
    setCats({ origin: false, x2: false, x4: false });
  }

  function close() {
    setMode(null);
    setCats({ origin: false, x2: false, x4: false });
  }

  function apply() {
    if (mode == null) return;
    const selected = (Object.keys(cats) as SelectionCategory[]).filter((c) => cats[c]);
    if (selected.length === 0) return;
    onApply(selected, mode === "select" ? "add" : "remove");
    close();
  }

  const counts: Record<SelectionCategory, number> = {
    origin: images.length,
    x2: images.reduce((n, im) => n + (im.upscales ?? []).filter((u) => u.scale === 2).length, 0),
    x4: images.reduce((n, im) => n + (im.upscales ?? []).filter((u) => u.scale === 4).length, 0),
  };
  const targetCount = (Object.keys(cats) as SelectionCategory[])
    .filter((c) => cats[c])
    .reduce((n, c) => n + counts[c], 0);
  const anyChecked = targetCount > 0;

  const rows: Array<{ cat: SelectionCategory; label: string; hint: string }> = [
    { cat: "origin", label: "origin images", hint: "the generated image itself, no upscale" },
    { cat: "x2", label: "upscale images (x2)", hint: "Real-ESRGAN ×2 variants" },
    { cat: "x4", label: "upscale images (x4)", hint: "Real-ESRGAN ×4 variants" },
  ];

  return (
    <div className="space-y-2" data-testid="bulk-select-bar">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => open("select")}
          aria-expanded={mode === "select"}
          className={cn(smallButton, mode === "select" && "border-ink")}
        >
          <ListChecks className="h-3.5 w-3.5" aria-hidden />
          Select all
        </button>
        <button
          type="button"
          onClick={() => open("deselect")}
          aria-expanded={mode === "deselect"}
          className={cn(smallButton, mode === "deselect" && "border-ink")}
        >
          <ListX className="h-3.5 w-3.5" aria-hidden />
          Deselect all
        </button>
        <span className="ml-auto font-mono text-[10.5px] text-ink-muted">
          applies to the {images.length} image{images.length === 1 ? "" : "s"} of page {page} — the
          selection follows you across pages
        </span>
      </div>

      {mode && (
        <div className="border border-line-strong bg-paper shadow-[var(--shadow-hard-sm)]" data-testid="bulk-select-panel">
          <div className="border-b border-line bg-surface px-3 py-2 font-mono text-[10.5px] uppercase tracking-wider text-ink-muted">
            {mode === "select" ? "Add to the selection" : "Remove from the selection"} — pick the
            categories (nothing is checked by default):
          </div>
          <div className="divide-y divide-line">
            {rows.map(({ cat, label, hint }) => (
              <CheckRow
                key={cat}
                checked={cats[cat]}
                onToggle={() => setCats((prev) => ({ ...prev, [cat]: !prev[cat] }))}
                label={label}
                hint={hint}
                count={counts[cat]}
                countLabel="on this page"
                disabled={counts[cat] === 0}
                testId={`check-${cat}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
            {mode === "deselect" && (
              <button
                type="button"
                onClick={onClearAll}
                className="flex h-9 items-center gap-1.5 border border-danger/40 bg-surface px-3 font-display text-xs font-semibold uppercase tracking-widest text-danger transition-colors hover:border-danger hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-brand"
              >
                <ListX className="h-3.5 w-3.5" aria-hidden />
                Clear everything
              </button>
            )}
            <button
              type="button"
              onClick={close}
              className="ml-auto flex h-9 items-center gap-1.5 px-3 font-display text-xs font-semibold uppercase tracking-widest text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Close
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={!anyChecked}
              className="flex h-9 items-center gap-2 bg-brand px-4 font-display text-xs font-bold uppercase tracking-widest text-white shadow-[var(--shadow-hard-sm)] transition-colors hover:bg-brand-deep disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-brand"
              data-testid="bulk-apply"
            >
              <ListChecks className="h-4 w-4" aria-hidden />
              {mode === "select" ? "Select" : "Deselect"} {targetCount}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
