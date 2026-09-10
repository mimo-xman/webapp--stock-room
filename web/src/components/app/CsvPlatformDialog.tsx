"use client";

/**
 * Platform picker dialog for the CSV export — shown when the user clicks
 * "Download CSV" with a selection. Lists every stock marketplace; clicking a
 * CSV-ready platform re-reads the whole selection from the DB FIRST
 * (fetchFresh — fresh rows, deleted assets skipped), then downloads that
 * platform's contributor CSV. Platforms without a documented bulk format
 * show "coming soon" (the owner will supply the format later — the metadata
 * for them is already stored).
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle2, Clock, Download, LoaderCircle, TriangleAlert, Ban } from "lucide-react";
import { PLATFORMS } from "@/lib/constants";
import { buildPlatformCsv, downloadCsvFile } from "@/lib/csv";
import { useToast } from "@/hooks/use-toast";
import type { CsvSelectionItem } from "@/lib/csv";
import { cn } from "@/lib/utils";
import type { PlatformId } from "@/lib/types";

interface CsvPlatformDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CsvSelectionItem[];
  /** Re-read the whole selection from the DB before building the CSV —
   *  never trust the grid snapshot for the export rows. */
  fetchFresh?: () => Promise<{ items: CsvSelectionItem[]; skipped: number }>;
}

export function CsvPlatformDialog({ open, onOpenChange, items, fetchFresh }: CsvPlatformDialogProps) {
  const { toast } = useToast();
  const [busyPlatform, setBusyPlatform] = useState<PlatformId | null>(null);

  async function pick(platform: PlatformId, csvReady: boolean) {
    if (!csvReady) {
      toast({
        title: "Coming soon",
        description: `The ${label(platform)} CSV format is not documented yet — its metadata is already stored and will export as soon as the format is added.`,
      });
      return;
    }
    if (busyPlatform) return;
    setBusyPlatform(platform);
    try {
      // fresh rows from the DB — the snapshot may lag behind stamps / edits
      let exportItems = items;
      let skippedNote = "";
      if (fetchFresh) {
        try {
          const fresh = await fetchFresh();
          exportItems = fresh.items;
          if (fresh.skipped > 0) {
            skippedNote = ` ${fresh.skipped} selected asset${fresh.skipped === 1 ? "" : "s"} no longer exist${fresh.skipped === 1 ? "s" : ""} — skipped.`;
          }
        } catch {
          // the DB read failed — build from the selection snapshot
        }
      }
      if (exportItems.length === 0) {
        toast({ variant: "destructive", title: "Nothing to export", description: "None of the selected assets exist anymore." });
        return;
      }
      const result = buildPlatformCsv(platform, exportItems);
      if (!result) {
        toast({ variant: "destructive", title: "Export failed", description: "No builder for this platform." });
        return;
      }
      downloadCsvFile(result.csv, result.filename);
      onOpenChange(false);
      toast({
        title: `${label(platform)} CSV downloaded`,
        description: result.warnings.length
          ? `${result.rows} row(s). ⚠ ${result.warnings[0]}${result.warnings.length > 1 ? ` (+${result.warnings.length - 1} more)` : ""}${skippedNote}`
          : `${result.rows} row(s) — upload the images first, then import this CSV on ${label(platform)}.${skippedNote}`,
      });
    } finally {
      setBusyPlatform(null);
    }
  }

  function label(id: string) {
    return PLATFORMS.find((p) => p.id === id)?.label ?? id;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-y-auto rounded-none border-ink bg-surface p-0 shadow-[var(--shadow-hard)] sm:max-w-lg">
        <DialogHeader className="border-b border-line p-4">
          <DialogTitle className="font-display text-lg font-bold uppercase tracking-wide">
            Download CSV — choose a platform
          </DialogTitle>
          <DialogDescription className="text-sm text-ink-muted">
            {items.length} asset{items.length === 1 ? "" : "s"} selected. The CSV is built in each
            platform&apos;s own contributor format — upload the images on the platform first, then
            import the CSV.
          </DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-line">
          {PLATFORMS.map((p) => {
            const csvReady = p.csv;
            const busy = busyPlatform === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(p.id, csvReady)}
                disabled={busyPlatform !== null}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-70",
                  csvReady ? "hover:bg-paper" : "hover:bg-paper/60",
                )}
                aria-label={`Download the ${p.label} CSV`}
              >
                {busy ? (
                  <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-brand" aria-hidden />
                ) : csvReady ? (
                  <Download className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                ) : (
                  <Clock className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                )}
                <span className="flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-display text-sm font-bold uppercase tracking-wide">{p.label}</span>
                    {csvReady ? (
                      <span className="chip border-brand/50 text-brand">CSV ready</span>
                    ) : (
                      <span className="chip border-line-strong text-ink-muted">coming soon</span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
                    {p.ai === "refused" ? (
                      <>
                        <Ban className="h-3 w-3 shrink-0 text-danger" aria-hidden />
                        <span className="text-danger/90">{p.aiNote}</span>
                      </>
                    ) : p.ai === "verify" ? (
                      <>
                        <TriangleAlert className="h-3 w-3 shrink-0 text-amber-600" aria-hidden />
                        <span>{p.aiNote}</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3 w-3 shrink-0 text-stamp" aria-hidden />
                        <span>{p.aiNote}</span>
                      </>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="border-t border-line bg-paper p-3">
          <p className="font-mono text-[10.5px] leading-relaxed text-ink-muted">
            Metadata for every platform is stored on each image — edit it from the image detail
            popup. CSV formats: Adobe&nbsp;Stock, Shutterstock, Dreamstime, 123RF, Pond5.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
