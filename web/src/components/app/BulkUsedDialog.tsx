"use client";

/**
 * Platform picker popup for the bulk mark/unmark-as-used — shown when the
 * owner clicks "Mark N as used" or "Unmark N as used" on the sticky
 * SelectionBar (multi-selection of /images and /sessions/:id).
 *
 * Every stock marketplace is listed as a checkbox row — NOTHING is checked
 * by default (the owner picks exactly where the batch is published):
 *
 *   [] Adobe Stock        12 to mark
 *   [] Shutterstock        0 marked   (disabled in unmark mode)
 *   …
 *
 * The stamp applies to the SELECTED ORIGIN IMAGES only: upscale variants
 * have no used state of their own — they follow their original image, so
 * checking "origin images" in the Select-all panel (or the per-card
 * checkboxes) is what feeds this popup. Upscales in the selection are
 * ignored for the stamp (they still feed the CSV export).
 *
 * Unmark mode adds a "Clear everything" shortcut that wipes every platform
 * of the whole selection in one click (same as the single-image stamp).
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ListX, LoaderCircle, Stamp, Trash2 } from "lucide-react";
import { CheckRow } from "./CheckRow";
import { PLATFORMS } from "@/lib/constants";
import type { CsvSelectionItem } from "@/lib/csv";
import type { PlatformId } from "@/lib/types";

interface BulkUsedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "mark" | "unmark";
  /** The whole checkbox selection — origins feed the stamp, upscales are ignored. */
  items: CsvSelectionItem[];
  /** Bulk request in flight ("Stamping…" state). */
  busy?: boolean;
  /** Confirm with the chosen platforms. */
  onConfirm: (platforms: PlatformId[]) => void;
  /** Unmark mode only: clear EVERY platform of the whole selection at once. */
  onClearAll?: () => void;
}

export function BulkUsedDialog({
  open,
  onOpenChange,
  mode,
  items,
  busy = false,
  onConfirm,
  onClearAll,
}: BulkUsedDialogProps) {
  const [checked, setChecked] = useState<Partial<Record<PlatformId, boolean>>>({});

  // Fresh popup every time it opens (or switches mode) — nothing checked.
  const resetKey = open ? mode : "";
  const [prevKey, setPrevKey] = useState("");
  if (resetKey !== prevKey) {
    setPrevKey(resetKey);
    setChecked({});
  }

  const origins = items.filter((it) => !it.upscale);
  const upscalesSelected = items.length - origins.length;

  const platformCount = (id: PlatformId) =>
    origins.filter((it) => (it.image.used?.[id] ?? false) === true).length;

  const chosen = PLATFORMS.filter((p) => checked[p.id]).map((p) => p.id);
  const anyChecked = chosen.length > 0;
  const marking = mode === "mark";

  function confirm() {
    if (!anyChecked || busy) return;
    onConfirm(chosen);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy && !next) return; // don't kill an in-flight stamp
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[88vh] gap-0 overflow-y-auto rounded-none border-ink bg-surface p-0 shadow-[var(--shadow-hard)] sm:max-w-md">
        <DialogHeader className="border-b border-line p-4">
          <DialogTitle className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide">
            {marking ? (
              <Stamp className="h-5 w-5 text-brand" aria-hidden />
            ) : (
              <ListX className="h-5 w-5 text-danger" aria-hidden />
            )}
            {marking ? "Mark as used" : "Unmark as used"} — choose the platforms
          </DialogTitle>
          <DialogDescription className="text-sm text-ink-muted">
            {origins.length} origin image{origins.length === 1 ? "" : "s"} selected
            {upscalesSelected > 0 ? ` (+ ${upscalesSelected} upscale${upscalesSelected === 1 ? "" : "s"}, which follow their original automatically)` : ""}
            {" — "}
            {marking
              ? "check every platform where the batch is published:"
              : "check the platforms to unmark, or clear everything at once:"}
          </DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-line">
          {PLATFORMS.map((p) => {
            const marked = platformCount(p.id);
            const disabled = busy || (marking ? false : marked === 0);
            return (
              <CheckRow
                key={p.id}
                checked={Boolean(checked[p.id])}
                onToggle={() => setChecked((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                label={p.label}
                hint={marking ? `${p.aiNote}` : `${origins.length - marked} not marked · ${p.aiNote}`}
                count={marking ? origins.length - marked : marked}
                countLabel={marking ? "to mark" : "marked"}
                disabled={disabled}
                testId={`bulk-platform-${p.id}`}
              />
            );
          })}
        </div>

        <div className="space-y-2 border-t border-line bg-paper p-3">
          <p className="font-mono text-[10.5px] leading-relaxed text-ink-muted">
            Upscale variants have no used state of their own — they follow their original
            image on every platform, so one stamp covers the whole set.
          </p>
          {busy && (
            <p className="flex items-center gap-2 font-mono text-[10.5px] text-ink-muted">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin text-brand" aria-hidden />
              stamping {origins.length} image{origins.length === 1 ? "" : "s"} in one request…
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!marking && onClearAll && (
              <button
                type="button"
                onClick={onClearAll}
                disabled={busy}
                className="flex h-10 items-center gap-1.5 border border-danger/40 bg-surface px-3 font-display text-xs font-semibold uppercase tracking-widest text-danger transition-colors hover:border-danger hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60"
                data-testid="bulk-unmark-clear-all"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Clear everything
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              className="ml-auto flex h-10 items-center gap-1.5 px-4 font-display text-xs font-semibold uppercase tracking-widest text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!anyChecked || busy}
              className={
                marking
                  ? "flex h-10 items-center gap-2 bg-brand px-4 font-display text-sm font-bold uppercase tracking-widest text-white shadow-[var(--shadow-hard-sm)] transition-colors hover:bg-brand-deep focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60"
                  : "flex h-10 items-center gap-2 border-2 border-danger/60 bg-surface px-4 font-display text-sm font-bold uppercase tracking-widest text-danger transition-colors hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60"
              }
              data-testid="bulk-used-confirm"
            >
              {busy ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Stamp className="h-4 w-4" aria-hidden />
              )}
              {busy
                ? "Stamping…"
                : marking
                  ? `Mark on ${chosen.length} platform${chosen.length === 1 ? "" : "s"}`
                  : `Unmark from ${chosen.length} platform${chosen.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
