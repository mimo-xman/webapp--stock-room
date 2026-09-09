"use client";

/**
 * "Download all as ZIP" popup — shown when the owner clicks the ZIP button
 * on an Etsy product card. Nothing is checked by default (the owner's spec):
 *
 *   [] origin images
 *   [] upscale images (x2)
 *   [] upscale images (x4)
 *   [] metadata
 *
 * The ZIP is built server-side (GET /api/etsy-products/:id/download-zip) and
 * streamed back: every selected file keeps the product's image order, and a
 * metadata.txt carries the listing block. Files that cannot be fetched at
 * their source never abort the archive — they land in _download-report.txt
 * inside the ZIP.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, FileArchive, LoaderCircle } from "lucide-react";
import { CheckRow } from "./CheckRow";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { EtsyProduct } from "@/lib/types";

interface EtsyZipDialogProps {
  product: EtsyProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EtsyZipDialog({ product, open, onOpenChange }: EtsyZipDialogProps) {
  const { toast } = useToast();
  const [opts, setOpts] = useState({ origin: false, x2: false, x4: false, metadata: false });
  const [busy, setBusy] = useState(false);

  // Fresh popup every time it opens (or switches product) — nothing checked.
  const resetKey = open && product ? product._id : "";
  const [prevKey, setPrevKey] = useState("");
  if (resetKey !== prevKey) {
    setPrevKey(resetKey);
    setOpts({ origin: false, x2: false, x4: false, metadata: false });
    setBusy(false);
  }

  const images = product?.images ?? [];
  const counts = {
    origin: images.length,
    x2: images.reduce((n, im) => n + (im.upscales ?? []).filter((u) => u.scale === 2).length, 0),
    x4: images.reduce((n, im) => n + (im.upscales ?? []).filter((u) => u.scale === 4).length, 0),
    metadata: 1,
  };
  const anyChecked = opts.origin || opts.x2 || opts.x4 || opts.metadata;

  async function download() {
    if (!product || busy || !anyChecked) return;
    setBusy(true);
    try {
      const result = await api.etsyProducts.downloadZip(product, opts);
      onOpenChange(false);
      toast({
        title: "ZIP downloaded",
        description:
          result.files > 0
            ? `${result.files} file(s) for "${product.metadata.title}" — check _download-report.txt inside if some images were missing at their source.`
            : `"${product.metadata.title}" saved — open the ZIP and check _download-report.txt: no image could be fetched at its source.`,
      });
    } catch (e: unknown) {
      const msg = (e as { payload?: { message?: string } })?.payload?.message || "Could not build the ZIP.";
      toast({ variant: "destructive", title: "Download failed", description: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy && !next) return; // don't kill an in-flight build
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[88vh] gap-0 overflow-y-auto rounded-none border-ink bg-surface p-0 shadow-[var(--shadow-hard)] sm:max-w-md">
        <DialogHeader className="border-b border-line p-4">
          <DialogTitle className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide">
            <FileArchive className="h-5 w-5 text-brand" aria-hidden />
            Download all as ZIP
          </DialogTitle>
          <DialogDescription className="text-sm text-ink-muted">
            {product ? `"${product.metadata.title}"` : "…"} — pick what goes into the archive:
            nothing is included until you check it.
          </DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-line">
          <CheckRow
            checked={opts.origin}
            onToggle={() => setOpts((p) => ({ ...p, origin: !p.origin }))}
            label="origin images"
            hint="the generated images themselves, no upscale"
            count={counts.origin}
            disabled={counts.origin === 0}
            testId="zip-check-origin"
          />
          <CheckRow
            checked={opts.x2}
            onToggle={() => setOpts((p) => ({ ...p, x2: !p.x2 }))}
            label="upscale images (x2)"
            hint="Real-ESRGAN ×2 variants"
            count={counts.x2}
            disabled={counts.x2 === 0}
            testId="zip-check-x2"
          />
          <CheckRow
            checked={opts.x4}
            onToggle={() => setOpts((p) => ({ ...p, x4: !p.x4 }))}
            label="upscale images (x4)"
            hint="Real-ESRGAN ×4 variants"
            count={counts.x4}
            disabled={counts.x4 === 0}
            testId="zip-check-x4"
          />
          <CheckRow
            checked={opts.metadata}
            onToggle={() => setOpts((p) => ({ ...p, metadata: !p.metadata }))}
            label="metadata"
            hint="metadata.txt — title, description, tags, price, prompts"
            count={counts.metadata}
            countLabel="file"
            testId="zip-check-metadata"
          />
        </div>

        <div className="space-y-2 border-t border-line bg-paper p-3">
          {busy && (
            <p className="flex items-center gap-2 font-mono text-[10.5px] text-ink-muted">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin text-brand" aria-hidden />
              building the ZIP server-side — fetching every selected image can take a minute
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              className="flex h-10 items-center gap-1.5 px-4 font-display text-xs font-semibold uppercase tracking-widest text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={download}
              disabled={!anyChecked || busy}
              className="flex h-10 items-center gap-2 bg-brand px-4 font-display text-sm font-bold uppercase tracking-widest text-white shadow-[var(--shadow-hard-sm)] transition-colors hover:bg-brand-deep focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60"
              data-testid="download-zip-confirm"
            >
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
              {busy ? "Building…" : "Download ZIP"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
