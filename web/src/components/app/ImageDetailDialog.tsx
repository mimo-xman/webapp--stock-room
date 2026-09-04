"use client";

/**
 * Image detail dialog — large preview with Original/upscaled variant switch,
 * all Adobe Stock metadata with quick copy icons, download, stamp toggle,
 * edit, delete. Upscaled variants (Real-ESRGAN via GitHub Actions) are
 * listed in the metadata column with per-variant mark-used / download /
 * delete actions. Optional looping prev/next navigation (arrows + ←/→ keys)
 * across the page's image list.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, ChevronLeft, ChevronRight, FileDown, Pencil, Trash2, Download, ImageOff, ArrowRight, ZoomIn, ExternalLink, AlertTriangle, CheckCircle2 } from "lucide-react";
import { CopyButton } from "./CopyButton";
import { StampToggle } from "./StampToggle";
import { StatusToggle } from "./StatusToggle";
import { ConfirmDialog } from "./ConfirmDialog";
import { api } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import type { StockImage, Upscale } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ImageDetailDialogProps {
  image: StockImage | null;
  onClose: () => void;
  onToggleUsed: (image: StockImage) => void;
  onEdit: (image: StockImage) => void;
  onDelete: (image: StockImage) => void;
  /** Notified whenever an upscale mutation returns the updated image,
   *  so the page can refresh its detail + list state. */
  onImageUpdate: (image: StockImage) => void;
  sessionTitle?: string;
  /** CSV export selection — when provided, the dialog adds selection
   *  controls: the original in the footer + one toggle per upscale row. */
  selection?: {
    isSelected: (imageId: string, variantId: string) => boolean;
    toggle: (image: StockImage, upscale?: Upscale) => void;
  };
  /** Looping prev/next navigation across the page's image list — the dialog
   *  renders side arrows + a position counter and handles the ←/→ keys.
   *  Provided by pages that own the list; undefined = feature off. */
  nav?: {
    images: StockImage[];
    onNavigate: (image: StockImage) => void;
  };
}

const VARIANT_ORIGINAL = "original";

export function ImageDetailDialog({
  image,
  onClose,
  onToggleUsed,
  onEdit,
  onDelete,
  onImageUpdate,
  sessionTitle,
  selection,
  nav,
}: ImageDetailDialogProps) {
  const [broken, setBroken] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [variant, setVariant] = useState<string>(VARIANT_ORIGINAL);
  const [confirmUpscaleDelete, setConfirmUpscaleDelete] = useState<Upscale | null>(null);
  const [busyUpscaleId, setBusyUpscaleId] = useState<string | null>(null);
  const [prevId, setPrevId] = useState<string>("");
  const [busyStatus, setBusyStatus] = useState(false);
  const [busyDismiss, setBusyDismiss] = useState(false);
  const { toast } = useToast();

  const metaScrollRef = useRef<HTMLDivElement>(null);

  // ── looping prev/next navigation across the page's image list ──
  const navIndex = nav && image ? nav.images.findIndex((i) => i._id === image._id) : -1;
  const canNavigate = Boolean(nav && nav.images.length > 1 && navIndex >= 0);

  function navigate(delta: -1 | 1) {
    if (!nav || !image || navIndex < 0 || nav.images.length < 2) return;
    const total = nav.images.length;
    // Loop: past the first image goes to the last, past the last to the first.
    nav.onNavigate(nav.images[(navIndex + delta + total) % total]);
  }

  // ← / → switch images while the dialog is open. The listener is re-attached
  // on every render so the closures stay fresh after each image switch.
  useEffect(() => {
    if (!image || !canNavigate) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigate(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigate(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Reset the metadata column scroll when the dialog switches to another image.
  useEffect(() => {
    metaScrollRef.current?.scrollTo({ top: 0 });
  }, [image?._id]);

  // Reset the transient states when the dialog switches to another image
  // (adjust-state-during-render pattern — same as FilterBar).
  if (image && prevId !== image._id) {
    setPrevId(image._id);
    setVariant(VARIANT_ORIGINAL);
    setBroken(false);
  }

  if (!image) return null;

  const upscales = image.upscales ?? [];
  const activeUpscale =
    variant !== VARIANT_ORIGINAL ? upscales.find((u) => u._id === variant) : undefined;

  const previewSrc = activeUpscale ? activeUpscale.url : image.image_link;
  const stampVisible = activeUpscale
    ? Boolean(activeUpscale.used_in_adobe_stock)
    : image.used_in_adobe_stock;

  async function toggleActive() {
    if (!image) return;
    // New state: reactivate when paused (absent field = active).
    const next = image.active === false;
    setBusyStatus(true);
    try {
      const res = await api.images.update(image._id, { active: next });
      onImageUpdate(res.data);
      toast({
        title: next ? "Image reactivated" : "Image paused",
        description: next
          ? "Eligible again for the next upscale batch run."
          : "Excluded from every upscale batch run until reactivated.",
      });
    } catch (e: unknown) {
      const msg = (e as { payload?: { message?: string } })?.payload?.message || "The status was not applied.";
      toast({ variant: "destructive", title: "Update failed", description: msg });
    } finally {
      setBusyStatus(false);
    }
  }

  async function dismissError() {
    if (!image) return;
    setBusyDismiss(true);
    try {
      const res = await api.images.update(image._id, { error_message: "" });
      onImageUpdate(res.data);
      toast({ title: "Error dismissed", description: "The failure message was cleared." });
    } catch (e: unknown) {
      const msg = (e as { payload?: { message?: string } })?.payload?.message || "The message was not cleared.";
      toast({ variant: "destructive", title: "Update failed", description: msg });
    } finally {
      setBusyDismiss(false);
    }
  }

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

  async function downloadUpscale(u: Upscale) {
    setBusyUpscaleId(u._id);
    try {
      await api.images.upscales.download(image!, u);
      toast({
        title: "Upscaled variant downloaded",
        description: `×${u.scale} · ${u.width ?? "?"}×${u.height ?? "?"} px saved to your downloads.`,
      });
    } catch (e: unknown) {
      const msg = (e as { payload?: { message?: string } })?.payload?.message || "Could not download this variant.";
      toast({ variant: "destructive", title: "Download failed", description: msg });
    } finally {
      setBusyUpscaleId(null);
    }
  }

  async function toggleUpscaleUsed(u: Upscale) {
    if (!image) return;
    const next = !u.used_in_adobe_stock;

    // Optimistic update of the parent state, rollback on error.
    const updated = {
      ...image,
      upscales: upscales.map((x) => (x._id === u._id ? { ...x, used_in_adobe_stock: next } : x)),
    };
    onImageUpdate(updated);
    try {
      const res = await api.images.upscales.update(image._id, u._id, { used_in_adobe_stock: next });
      onImageUpdate(res.data);
    } catch (e: unknown) {
      onImageUpdate(image); // rollback
      const msg = (e as { payload?: { message?: string } })?.payload?.message || "The stamp was not applied.";
      toast({ variant: "destructive", title: "Update failed", description: msg });
    }
  }

  async function deleteUpscale(u: Upscale) {
    if (!image) return;
    setBusyUpscaleId(u._id);
    try {
      await api.images.upscales.remove(image._id, u._id);
      const updated = { ...image, upscales: upscales.filter((x) => x._id !== u._id) };
      if (variant === u._id) setVariant(VARIANT_ORIGINAL);
      onImageUpdate(updated);
      toast({ title: "Upscaled variant deleted", description: `×${u.scale} variant removed from the image.` });
    } catch (e: unknown) {
      const msg = (e as { payload?: { message?: string } })?.payload?.message || "Try again in a moment.";
      toast({ variant: "destructive", title: "Delete failed", description: msg });
    } finally {
      setBusyUpscaleId(null);
      setConfirmUpscaleDelete(null);
    }
  }

  return (
    <Dialog open={!!image} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 rounded-none border-ink bg-surface p-0 shadow-[var(--shadow-hard)] sm:max-w-4xl">
        <div className="grid max-h-[85vh] overflow-hidden md:grid-cols-[minmax(0,1.35fr)_minmax(300px,1fr)]">
          {/* preview */}
          <div className="relative flex flex-col border-b border-line bg-muted md:border-b-0 md:border-r">
            <div className="flex flex-1 items-center justify-center">
              {broken ? (
                <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 text-ink-muted">
                  <ImageOff className="h-8 w-8" aria-hidden />
                  <span className="font-mono text-[11px] uppercase tracking-wider">
                    {activeUpscale ? "upscale link unreachable" : "image link unreachable"}
                  </span>
                </div>
              ) : (
                <img
                  key={previewSrc}
                  src={previewSrc}
                  alt={activeUpscale ? `${image.title} — upscaled ×${activeUpscale.scale}` : image.title}
                  onError={() => setBroken(true)}
                  className="max-h-[42vh] w-full object-contain md:max-h-[62vh]"
                />
              )}
              {stampVisible && (
                <span className="stamp stamp-thunk pointer-events-none absolute" data-testid="detail-stamp">
                  Used · Adobe Stock
                </span>
              )}

              {/* Looping prev/next navigation (arrows + position counter) */}
              {canNavigate && nav && (
                <>
                  <button
                    type="button"
                    onClick={() => navigate(-1)}
                    aria-label="Previous image (loops back to the last one)"
                    title="Previous image — ←"
                    data-testid="detail-nav-prev"
                    className="absolute left-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center border-2 border-ink bg-surface/90 text-ink shadow-[var(--shadow-hard-sm)] transition-colors hover:bg-ink hover:text-paper focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(1)}
                    aria-label="Next image (loops back to the first one)"
                    title="Next image — →"
                    data-testid="detail-nav-next"
                    className="absolute right-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center border-2 border-ink bg-surface/90 text-ink shadow-[var(--shadow-hard-sm)] transition-colors hover:bg-ink hover:text-paper focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <ChevronRight className="h-5 w-5" aria-hidden />
                  </button>
                  <span
                    data-testid="detail-nav-counter"
                    aria-label={`Image ${navIndex + 1} of ${nav.images.length}`}
                    className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 border border-line-strong bg-surface/90 px-2 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-ink shadow-[var(--shadow-hard-sm)]"
                  >
                    {navIndex + 1} / {nav.images.length}
                  </span>
                </>
              )}
            </div>

            {/* Original / upscaled variant switcher */}
            {upscales.length > 0 && (
              <div
                className="flex flex-wrap items-center gap-1.5 border-t border-line bg-paper p-2"
                role="tablist"
                aria-label="Image variants"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={variant === VARIANT_ORIGINAL}
                  onClick={() => {
                    setVariant(VARIANT_ORIGINAL);
                    setBroken(false);
                  }}
                  className={cn(
                    "chip border-line-strong transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                    variant === VARIANT_ORIGINAL
                      ? "border-ink bg-ink text-paper"
                      : "bg-surface text-ink hover:border-ink"
                  )}
                >
                  Original
                </button>
                {upscales.map((u) => (
                  <button
                    key={u._id}
                    type="button"
                    role="tab"
                    aria-selected={variant === u._id}
                    title={`×${u.scale} · ${u.model} · ${u.width ?? "?"}×${u.height ?? "?"} px`}
                    onClick={() => {
                      setVariant(u._id);
                      setBroken(false);
                    }}
                    className={cn(
                      "chip border-line-strong transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                    variant === u._id
                        ? "border-ink bg-ink text-paper"
                        : "bg-surface text-ink hover:border-ink"
                    )}
                  >
                    <ZoomIn className="mr-1 inline h-3 w-3" aria-hidden />×{u.scale}
                  </button>
                ))}
              </div>
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
                {upscales.length > 0 && (
                  <span className="chip border-brand/60 text-brand" title={`${upscales.length} upscaled variant(s)`}>
                    <ZoomIn className="mr-1 inline h-3 w-3" aria-hidden />×{upscales.length}
                  </span>
                )}
                <CopyButton value={image.title} label="title" className="ml-1" />
                <CopyButton value={image.category} label="category" />
              </div>
            </DialogHeader>

            <div ref={metaScrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {/* ── batch-worker error banner (failure message + dismiss) ── */}
              {image.error_message && (
                <section
                  className="border border-danger bg-danger-soft p-3"
                  data-testid="error-banner"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="eyebrow flex items-center gap-1.5 text-danger">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                      Last upscale error
                    </h4>
                    <CopyButton value={image.error_message} label="error message" />
                  </div>
                  <p className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap border border-danger/30 bg-surface p-2.5 font-mono text-[11.5px] leading-relaxed text-danger">
                    {image.error_message}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={dismissError}
                      disabled={busyDismiss}
                      className="flex h-[30px] items-center gap-1.5 border-2 border-danger/50 bg-surface px-3 font-display text-[11px] font-bold uppercase tracking-widest text-danger transition-colors hover:border-danger hover:bg-danger hover:text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-brand"
                      data-testid="dismiss-error"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      {busyDismiss ? "Dismissing…" : "Dismiss"}
                    </button>
                    {image.active === false && (
                      <span className="font-mono text-[10.5px] uppercase tracking-wider text-danger">
                        image paused — reactivate below once fixed
                      </span>
                    )}
                  </div>
                </section>
              )}

              {image.in_use === true && (
                <p className="flex items-center gap-2 border border-brand/40 bg-paper p-2.5 font-mono text-[11px] text-brand" data-testid="in-use-banner">
                  <span
                    className="h-2 w-2 animate-pulse rounded-full bg-brand"
                    aria-hidden
                  />
                  Claimed by an upscale worker right now — the result will appear in Upscales when done.
                </p>
              )}

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

              {/* ── upscaled variants ── */}
              <section>
                <h4 className="eyebrow">Upscales ({upscales.length})</h4>
                {upscales.length === 0 ? (
                  <p className="mt-1.5 border border-line bg-paper p-2.5 font-mono text-[11px] leading-relaxed text-ink-muted">
                    No upscaled variant yet — the daily GitHub Actions job adds Real-ESRGAN
                    upscales here automatically (see docs/UPSCALE.md).
                  </p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {upscales.map((u) => (
                      <li
                        key={u._id}
                        className={cn(
                          "border bg-paper p-2.5",
                          variant === u._id ? "border-ink" : "border-line"
                        )}
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-[11.5px]">
                          <span className="font-semibold text-ink">×{u.scale}</span>
                          <span className="text-ink-muted">{u.model}</span>
                          <span className="text-ink-muted">
                            {u.width && u.height ? `${u.width}×${u.height} px` : "—"}
                          </span>
                          <span className="text-ink-muted">{formatBytes(u.size_bytes)}</span>
                        </div>
                        <div className="mt-0.5 font-mono text-[10.5px] text-ink-muted">
                          {formatDateTime(u.created_at)}
                          {u.run_id ? ` · run ${u.run_id}` : ""}
                          {u.source ? ` · ${u.source}` : ""}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={selection?.isSelected(image._id, u._id) ?? false}
                            aria-label={`Add the ×${u.scale} variant to the Adobe Stock CSV`}
                            title="Add to the Adobe Stock CSV selection"
                            disabled={!selection}
                            onClick={() => selection?.toggle(image, u)}
                            className={cn(
                              "flex h-[26px] items-center gap-1 border px-2 font-display text-[10.5px] font-semibold uppercase tracking-wider transition-colors focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50",
                              selection?.isSelected(image._id, u._id)
                                ? "border-brand bg-brand text-white"
                                : "border-line-strong bg-surface text-ink hover:border-brand hover:text-brand"
                            )}
                            data-testid="select-upscale"
                          >
                            {selection?.isSelected(image._id, u._id) ? (
                              <Check className="h-3 w-3" aria-hidden />
                            ) : (
                              <FileDown className="h-3 w-3" aria-hidden />
                            )}
                            CSV
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setVariant(u._id);
                              setBroken(false);
                            }}
                            className="flex h-[26px] items-center gap-1 border border-line-strong bg-surface px-2 font-display text-[10.5px] font-semibold uppercase tracking-wider text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-brand"
                            aria-label={`View the ×${u.scale} variant in the preview`}
                          >
                            <ZoomIn className="h-3 w-3" aria-hidden />
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadUpscale(u)}
                            disabled={busyUpscaleId === u._id}
                            className="flex h-[26px] items-center gap-1 border border-line-strong bg-surface px-2 font-display text-[10.5px] font-semibold uppercase tracking-wider text-ink transition-colors hover:border-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-brand"
                            aria-label={`Download the ×${u.scale} variant`}
                          >
                            <Download className="h-3 w-3" aria-hidden />
                            {busyUpscaleId === u._id ? "…" : "Download"}
                          </button>
                          <a
                            href={u.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex h-[26px] items-center gap-1 border border-line-strong bg-surface px-2 font-display text-[10.5px] font-semibold uppercase tracking-wider text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-brand"
                            aria-label={`Open the ×${u.scale} variant on Cloudinary`}
                          >
                            <ExternalLink className="h-3 w-3" aria-hidden />
                            Cloudinary
                          </a>
                          <StampToggle
                            used={Boolean(u.used_in_adobe_stock)}
                            small
                            onToggle={() => toggleUpscaleUsed(u)}
                            className="ml-auto"
                            label={`Mark the ×${u.scale} variant as used in Adobe Stock`}
                          />
                          <button
                            type="button"
                            onClick={() => setConfirmUpscaleDelete(u)}
                            className="flex h-[26px] items-center gap-1 border border-danger/40 bg-surface px-2 font-display text-[10.5px] font-semibold uppercase tracking-wider text-danger transition-colors hover:border-danger hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-brand"
                            aria-label={`Delete the ×${u.scale} variant`}
                          >
                            <Trash2 className="h-3 w-3" aria-hidden />
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
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
              {selection && (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={selection.isSelected(image._id, "original")}
                  aria-label="Add the original image to the Adobe Stock CSV"
                  title="Add the ORIGINAL image to the Adobe Stock CSV selection"
                  onClick={() => selection.toggle(image)}
                  className={cn(
                    "flex h-[34px] items-center gap-1.5 border px-3 font-display text-xs font-semibold uppercase tracking-widest transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                    selection.isSelected(image._id, "original")
                      ? "border-brand bg-brand text-white"
                      : "border-line-strong bg-surface text-ink hover:border-brand hover:text-brand"
                  )}
                  data-testid="select-original-dialog"
                >
                  {selection.isSelected(image._id, "original") ? (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <FileDown className="h-3.5 w-3.5" aria-hidden />
                  )}
                  CSV
                </button>
              )}
              <StampToggle used={image.used_in_adobe_stock} onToggle={() => onToggleUsed(image)} />
              <StatusToggle
                active={image.active !== false}
                disabled={busyStatus}
                onToggle={toggleActive}
                label={image.active !== false ? "Pause this image (exclude from batch runs)" : "Reactivate this image"}
              />
              <button
                type="button"
                onClick={download}
                disabled={downloading}
                className="flex h-[34px] items-center gap-2 bg-brand px-3.5 font-display text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-brand-deep disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-brand"
              >
                <Download className="h-4 w-4" aria-hidden />
                {downloading ? "Downloading…" : activeUpscale ? "Download original" : "Download"}
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

      <ConfirmDialog
        open={!!confirmUpscaleDelete}
        onOpenChange={(open) => !open && setConfirmUpscaleDelete(null)}
        title={`Delete the ×${confirmUpscaleDelete?.scale ?? ""} upscaled variant?`}
        description={
          confirmUpscaleDelete
            ? `The ×${confirmUpscaleDelete.scale} variant (${confirmUpscaleDelete.model}${
                confirmUpscaleDelete.width && confirmUpscaleDelete.height
                  ? `, ${confirmUpscaleDelete.width}×${confirmUpscaleDelete.height} px`
                  : ""
              }) will be removed from this image. The Cloudinary file is deleted too when the API has Cloudinary credentials configured. The original image is untouched.`
            : ""
        }
        confirmLabel="Delete variant"
        danger
        onConfirm={() => {
          if (confirmUpscaleDelete) deleteUpscale(confirmUpscaleDelete);
        }}
      />
    </Dialog>
  );
}
