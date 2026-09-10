"use client";

/**
 * Image detail dialog — large preview with Original/upscaled variant switch,
 * the image's per-platform upload metadata (one collapsible card per stock
 * marketplace with its title/description/categories/keywords + copy buttons +
 * per-platform "used" stamp), download, edit, delete. Upscaled variants
 * (Real-ESRGAN via GitHub Actions) are listed in the metadata column with
 * per-variant download / delete actions — they have NO stamp of their own:
 * an upscale is the same image as its original, so it follows the original's
 * used state on every platform (the preview stamp and the row chip show it).
 * Optional looping prev/next navigation (arrows + ←/→ keys) across the page's
 * image list.
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
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileDown,
  Pencil,
  Trash2,
  Download,
  ImageOff,
  ArrowRight,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Ban,
  TriangleAlert,
  ZoomIn,
} from "lucide-react";
import { CopyButton } from "./CopyButton";
import { StampToggle } from "./StampToggle";
import { StatusToggle } from "./StatusToggle";
import { ConfirmDialog } from "./ConfirmDialog";
import { api } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { PLATFORMS } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import type { PlatformId, StockImage, Upscale } from "@/lib/types";
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

/** One platform's metadata card (collapsible). */
function PlatformCard({
  image,
  platformId,
  label,
  open,
  onOpenChange,
  onTogglePlatformUsed,
  busy,
}: {
  image: StockImage;
  platformId: PlatformId;
  label: string;
  open: boolean;
  onOpenChange: () => void;
  onTogglePlatformUsed: (platform: PlatformId) => void;
  busy: boolean;
}) {
  const meta = image.metadata?.[platformId] as Record<string, unknown> | undefined;
  const used = image.used?.[platformId] === true;
  const def = PLATFORMS.find((p) => p.id === platformId);
  const isEmpty = !meta;

  const keywords = Array.isArray(meta?.keywords) ? (meta!.keywords as string[]) : [];
  const title = typeof meta?.title === "string" ? (meta.title as string) : typeof meta?.description === "string" ? (meta.description as string) : "";
  const description = typeof meta?.description === "string" ? (meta.description as string) : "";
  const categories = Array.isArray(meta?.categories) ? (meta.categories as string[]) : [];
  const price = typeof meta?.price === "number" ? (meta.price as number) : undefined;

  return (
    <div
      className={cn(
        "border bg-paper",
        open ? "border-ink" : "border-line",
        isEmpty && "opacity-80",
      )}
      data-testid={`platform-${platformId}`}
    >
      <button
        type="button"
        onClick={onOpenChange}
        aria-expanded={open}
        className="flex w-full items-center gap-2 p-2.5 text-left transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-brand"
        aria-label={`${label} metadata`}
      >
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
        <span className="font-display text-xs font-bold uppercase tracking-wider">{label}</span>
        {used && <span className="chip border-stamp/60 text-stamp">used</span>}
        {isEmpty && <span className="chip border-line-strong text-ink-muted">no metadata</span>}
        {def?.ai === "refused" && (
          <span className="chip border-danger/50 text-danger" title={def.aiNote}>
            <Ban className="mr-0.5 h-3 w-3" aria-hidden />
            no AI
          </span>
        )}
        {def?.ai === "verify" && (
          <span className="chip border-amber-500/50 text-amber-600" title={def.aiNote}>
            <TriangleAlert className="mr-0.5 h-3 w-3" aria-hidden />
            check policy
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-ink-muted">
          {keywords.length} kw
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-line p-2.5">
          {isEmpty ? (
            <p className="font-mono text-[11px] leading-relaxed text-ink-muted">
              No metadata stored for {label} — edit the image to add it, or re-run the generation
              agent (it writes every platform&apos;s metadata).
            </p>
          ) : (
            <>
              {title && (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h5 className="eyebrow">{def?.titleField === "description" ? "Description" : "Title"}</h5>
                    <CopyButton value={title} label={`${label} title`} />
                  </div>
                  <p className="mt-0.5 border border-line bg-surface p-2 font-mono text-[11.5px] leading-relaxed">
                    {title}
                  </p>
                </div>
              )}
              {description && description !== title && (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h5 className="eyebrow">Description</h5>
                    <CopyButton value={description} label={`${label} description`} />
                  </div>
                  <p className="mt-0.5 max-h-24 overflow-y-auto border border-line bg-surface p-2 font-mono text-[11.5px] leading-relaxed">
                    {description}
                  </p>
                </div>
              )}
              {categories.length > 0 && (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h5 className="eyebrow">Categories</h5>
                    <CopyButton value={categories.join(", ")} label={`${label} categories`} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {categories.map((c) => (
                      <span key={c} className="border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {price !== undefined && (
                <p className="font-mono text-[11px] text-ink-muted">
                  price <span className="font-semibold text-ink">${price.toFixed(2)}</span>
                </p>
              )}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h5 className="eyebrow">Keywords ({keywords.length})</h5>
                  <CopyButton value={keywords.join(",")} label={`${label} keywords (comma separated)`} />
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {keywords.map((k) => (
                    <span key={k} className="border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink">
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="pt-1">
            <StampToggle
              used={used}
              small
              busy={busy}
              onToggle={() => onTogglePlatformUsed(platformId)}
              label={`Mark as used on ${label}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

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
  const [openPlatform, setOpenPlatform] = useState<string | null>("adobe_stock");
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null);
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

  // ── fresh data on open / image switch ──
  // The dialog is rendered from the grid snapshot for the first paint, then
  // silently re-reads the image from the DB (GET /api/images/:id) — reads
  // never trust cached state. A mutation during the read bumps mutationSeq
  // so the response is discarded instead of clobbering the newer DB state.
  const mutationSeq = useRef(0);
  useEffect(() => {
    const id = image?._id;
    if (!id) return;
    const seq = mutationSeq.current;
    let alive = true;
    api.images
      .get(id)
      .then((res) => {
        if (!alive || seq !== mutationSeq.current || res.data._id !== id) return;
        onImageUpdate(res.data);
      })
      .catch(() => {
        /* silent — the snapshot stays until the next mutation/open */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onImageUpdate is a page-level callback
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
  const anyUsed = (image.used_count ?? 0) > 0 || Object.values(image.used ?? {}).some(Boolean);
  // Upscales follow their original image: the stamp shows whenever the
  // original is used somewhere, whichever variant is being previewed.
  const stampVisible = anyUsed;
  const displayTitle = image.title || image.metadata?.adobe_stock?.title || "Untitled";

  async function toggleActive() {
    if (!image) return;
    // New state: reactivate when paused (absent field = active).
    const next = image.active === false;
    mutationSeq.current += 1;
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
    mutationSeq.current += 1;
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

  /** Per-platform used stamp — writes used.<platform> only. */
  async function togglePlatformUsed(platform: PlatformId) {
    if (!image) return;
    const next = image.used?.[platform] !== true;
    mutationSeq.current += 1;
    setBusyPlatform(platform);
    try {
      const res = await api.images.update(image._id, { used: { [platform]: next } });
      onImageUpdate(res.data);
      toast({
        title: next ? "Marked as used" : "Unmarked",
        description: `${PLATFORMS.find((p) => p.id === platform)?.label}: ${next ? "the image is flagged as published there." : "flag removed."}`,
      });
    } catch (e: unknown) {
      const msg = (e as { payload?: { message?: string } })?.payload?.message || "The stamp was not applied.";
      toast({ variant: "destructive", title: "Update failed", description: msg });
    } finally {
      setBusyPlatform(null);
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

  async function deleteUpscale(u: Upscale) {
    if (!image) return;
    mutationSeq.current += 1;
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
                  alt={activeUpscale ? `${displayTitle} — upscaled ×${activeUpscale.scale}` : displayTitle}
                  onError={() => setBroken(true)}
                  className="max-h-[42vh] w-full object-contain md:max-h-[62vh]"
                />
              )}
              {stampVisible && (
                <span className="stamp stamp-thunk pointer-events-none absolute" data-testid="detail-stamp">
                  Used · published
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
                {displayTitle}
              </DialogTitle>
              <DialogDescription className="sr-only">Image metadata and actions</DialogDescription>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {image.category && (
                  <span className="chip border-line-strong text-ink" title="Adobe Stock category">
                    {image.category}
                  </span>
                )}
                <span className="chip">{image.quality}</span>
                <span className="chip">{image.ratio}</span>
                {upscales.length > 0 && (
                  <span className="chip border-brand/60 text-brand" title={`${upscales.length} upscaled variant(s)`}>
                    <ZoomIn className="mr-1 inline h-3 w-3" aria-hidden />×{upscales.length}
                  </span>
                )}
                {anyUsed && (
                  <span className="chip border-stamp/60 text-stamp">
                    used on {Object.values(image.used ?? {}).filter(Boolean).length} platform
                    {Object.values(image.used ?? {}).filter(Boolean).length === 1 ? "" : "s"}
                  </span>
                )}
                <CopyButton value={displayTitle} label="title" className="ml-1" />
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

              {/* ── per-platform upload metadata ── */}
              <section>
                <h4 className="eyebrow">Platform upload metadata</h4>
                <div className="mt-1.5 space-y-1.5">
                  {PLATFORMS.map((p) => (
                    <PlatformCard
                      key={p.id}
                      image={image}
                      platformId={p.id}
                      label={p.label}
                      open={openPlatform === p.id}
                      onOpenChange={() => setOpenPlatform(openPlatform === p.id ? null : p.id)}
                      onTogglePlatformUsed={togglePlatformUsed}
                      busy={busyPlatform === p.id}
                    />
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
                            aria-label={`Add the ×${u.scale} variant to the CSV export`}
                            title="Add to the CSV export selection"
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
                          {anyUsed && (
                            <span
                              className="chip ml-auto border-stamp/60 text-stamp"
                              title="The original image is marked as used — an upscale is the same image, so it follows the original on every platform"
                              data-testid="upscale-follows-original"
                            >
                              used — follows original
                            </span>
                          )}
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
                  aria-label="Add the original image to the CSV export"
                  title="Add the ORIGINAL image to the CSV export selection"
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
              <StampToggle
                used={anyUsed}
                onToggle={() => onToggleUsed(image)}
                label="Toggle the used state (mark = Adobe Stock, unmark = clear every platform)"
              />
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
        description={`"${displayTitle}" will be removed from the database. The generated file stays wherever it is hosted — this only removes the record.`}
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
