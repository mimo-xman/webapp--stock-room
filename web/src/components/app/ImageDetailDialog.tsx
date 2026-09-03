"use client";

/**
 * Image detail dialog — large preview, all Adobe Stock metadata with
 * quick copy icons, download, stamp toggle, edit, delete.
 */

import { useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, Trash2, Download, ImageOff, ArrowRight } from "lucide-react";
import { CopyButton } from "./CopyButton";
import { StampToggle } from "./StampToggle";
import { ConfirmDialog } from "./ConfirmDialog";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import type { StockImage } from "@/lib/types";

interface ImageDetailDialogProps {
  image: StockImage | null;
  onClose: () => void;
  onToggleUsed: (image: StockImage) => void;
  onEdit: (image: StockImage) => void;
  onDelete: (image: StockImage) => void;
  sessionTitle?: string;
}

export function ImageDetailDialog({
  image,
  onClose,
  onToggleUsed,
  onEdit,
  onDelete,
  sessionTitle,
}: ImageDetailDialogProps) {
  const [broken, setBroken] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { toast } = useToast();

  if (!image) return null;

  async function download() {
    setDownloading(true);
    try {
      await api.images.download(image!);
      toast({ title: "Downloaded", description: "Image saved to your downloads." });
    } catch (e: unknown) {
      const msg = (e as { payload?: { message?: string } })?.payload?.message || "Could not download the image.";
      toast({ variant: "destructive", title: "Download failed", description: msg });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open={!!image} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 rounded-none border-ink bg-surface p-0 shadow-[var(--shadow-hard)] sm:max-w-4xl">
        <div className="grid max-h-[85vh] overflow-hidden md:grid-cols-[minmax(0,1.35fr)_minmax(300px,1fr)]">
          {/* preview */}
          <div className="relative flex items-center justify-center border-b border-line bg-muted md:border-b-0 md:border-r">
            {broken ? (
              <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 text-ink-muted">
                <ImageOff className="h-8 w-8" aria-hidden />
                <span className="font-mono text-[11px] uppercase tracking-wider">
                  image link unreachable
                </span>
              </div>
            ) : (
              <img
                key={image.image_link}
                src={image.image_link}
                alt={image.title}
                onError={() => setBroken(true)}
                className="max-h-[42vh] w-full object-contain md:max-h-[70vh]"
              />
            )}
            {image.used_in_adobe_stock && (
              <span className="stamp stamp-thunk pointer-events-none absolute" data-testid="detail-stamp">
                Used · Adobe Stock
              </span>
            )}
          </div>

          {/* metadata */}
          <div className="flex min-h-0 flex-col">
            <DialogHeader className="border-b border-line p-4 pr-10">
              <DialogTitle className="text-left font-display text-lg font-bold uppercase leading-tight tracking-wide">
                {image.title}
              </DialogTitle>
              <DialogDescription className="sr-only">Image metadata and actions</DialogDescription>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="chip border-line-strong text-ink">{image.category}</span>
                <span className="chip">{image.quality}</span>
                <span className="chip">{image.ratio}</span>
                <CopyButton value={image.title} label="title" className="ml-1" />
                <CopyButton value={image.category} label="category" />
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <section>
                <div className="flex items-center justify-between gap-2">
                  <h4 className="eyebrow">Keywords ({image.keywords.length})</h4>
                  <CopyButton value={image.keywords.join(",")} label="keywords (comma separated)" />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {image.keywords.map((k) => (
                    <span key={k} className="border border-line bg-paper px-1.5 py-0.5 font-mono text-[11px] text-ink">
                      {k}
                    </span>
                  ))}
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between gap-2">
                  <h4 className="eyebrow">Generation prompt</h4>
                  <CopyButton value={image.prompt} label="prompt" />
                </div>
                <p className="mt-1.5 max-h-28 overflow-y-auto border border-line bg-paper p-2.5 font-mono text-[11.5px] leading-relaxed text-ink-muted">
                  {image.prompt}
                </p>
              </section>

              <section className="space-y-1.5 font-mono text-[11.5px] text-ink-muted">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="eyebrow">Session</h4>
                  <Link
                    href={`/sessions/${image.session_id}`}
                    className="flex items-center gap-1 text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand"
                    onClick={onClose}
                  >
                    {sessionTitle ? sessionTitle.slice(0, 24) : image.session_id.slice(0, 12)}
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </Link>
                </div>
                <p>created {formatDateTime(image.createdAt)}</p>
                <p>updated {formatDateTime(image.updatedAt)}</p>
                <p className="truncate">id {image._id}</p>
              </section>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-line bg-paper p-3">
              <StampToggle used={image.used_in_adobe_stock} onToggle={() => onToggleUsed(image)} />
              <button
                type="button"
                onClick={download}
                disabled={downloading}
                className="flex h-[34px] items-center gap-2 bg-brand px-3.5 font-display text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-brand-deep disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-brand"
              >
                <Download className="h-4 w-4" aria-hidden />
                {downloading ? "Downloading…" : "Download"}
              </button>
              <button
                type="button"
                onClick={() => onEdit(image)}
                className="flex h-[34px] items-center gap-2 border border-line-strong bg-surface px-3 font-display text-xs font-semibold uppercase tracking-widest text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-brand"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Edit
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="ml-auto flex h-[34px] items-center gap-2 border border-danger/40 bg-surface px-3 font-display text-xs font-semibold uppercase tracking-widest text-danger transition-colors hover:border-danger hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-brand"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Delete
              </button>
            </div>
          </div>
        </div>
      </DialogContent>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this image?"
        description={`"${image.title}" will be removed from the database. The generated file stays wherever it is hosted — this only removes the record.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete(image);
        }}
      />
    </Dialog>
  );
}
