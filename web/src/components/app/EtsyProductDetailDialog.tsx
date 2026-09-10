"use client";

/**
 * Etsy product detail dialog — image-by-image viewer (the owner's spec):
 *
 *   LEFT   the current image large, prev/next buttons (looping) + a position
 *          counter, and — exactly like the sellable-images detail — a variant
 *          switcher at the BOTTOM to flip between the original and its
 *          upscaled versions (Real-ESRGAN via GitHub Actions).
 *   RIGHT  the product's Etsy listing metadata (description / tags / category
 *          / price / deliverable link) + the CURRENT image's info (role,
 *          caption, prompt, worker banners, per-image upscales with
 *          View / Download / Cloudinary / Delete), session.
 *
 * Each nested image carries its own upscales + worker fields (in_use /
 * active / error_message) — every banner and action is PER IMAGE, matching
 * the per-image claim protocol of the upscale-etsy-batch workflow.
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
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileDown,
  ImageOff,
  Images,
  Pencil,
  Tag,
  Trash2,
  ZoomIn,
} from "lucide-react";
import { CopyButton } from "./CopyButton";
import { StampToggle } from "./StampToggle";
import { StatusToggle } from "./StatusToggle";
import { ConfirmDialog } from "./ConfirmDialog";
import { api } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { etsyProductTypeLabel, etsyImageRoleLabel } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import type { EtsyProduct, EtsyProductImage, Upscale } from "@/lib/types";
import { cn } from "@/lib/utils";

interface EtsyProductDetailDialogProps {
  product: EtsyProduct | null;
  onClose: () => void;
  onProductUpdate: (product: EtsyProduct) => void;
  onEdit: (product: EtsyProduct) => void;
  onDelete: (product: EtsyProduct) => void;
  sessionTitle?: string;
}

const VARIANT_ORIGINAL = "original";

export function EtsyProductDetailDialog({
  product,
  onClose,
  onProductUpdate,
  onEdit,
  onDelete,
  sessionTitle,
}: EtsyProductDetailDialogProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busyStamp, setBusyStamp] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [busyUpscaleId, setBusyUpscaleId] = useState<string | null>(null);
  const [confirmUpscaleDelete, setConfirmUpscaleDelete] = useState<Upscale | null>(null);
  const [busyStatus, setBusyStatus] = useState(false);
  const [busyDismiss, setBusyDismiss] = useState(false);
  const { toast } = useToast();

  // ── viewer state: which image is shown, and which variant of it ──
  const [index, setIndex] = useState(0);
  const [variant, setVariant] = useState<string>(VARIANT_ORIGINAL);
  const [broken, setBroken] = useState(false);
  const [prevId, setPrevId] = useState<string>("");

  const metaScrollRef = useRef<HTMLDivElement>(null);

  const images = product?.images ?? [];

  // Reset the viewer when the dialog opens on another product.
  if (product && prevId !== product._id) {
    setPrevId(product._id);
    setIndex(0);
    setVariant(VARIANT_ORIGINAL);
    setBroken(false);
  }

  // Clamp the index if the images array shrank (an image was removed).
  const safeIndex = images.length === 0 ? 0 : Math.min(index, images.length - 1);
  const image: EtsyProductImage | undefined = images[safeIndex];

  // Switching image → back to the original variant + reset the broken flag
  // (adjust-during-render pattern — setState directly in an effect is the
  // lint error react-hooks/set-state-in-effect).
  const navKey = product ? `${product._id}:${safeIndex}` : "";
  const [prevNavKey, setPrevNavKey] = useState("");
  if (prevNavKey !== navKey) {
    setPrevNavKey(navKey);
    setVariant(VARIANT_ORIGINAL);
    setBroken(false);
  }

  // The metadata column scrolls back to the top on every image switch —
  // a pure DOM side effect, no state involved.
  useEffect(() => {
    metaScrollRef.current?.scrollTo({ top: 0 });
  }, [navKey]);

  // ── fresh data on open / product switch ──
  // The dialog renders from the grid snapshot for the first paint, then
  // silently re-reads the product from the DB (GET /api/etsy-products/:id)
  // — reads never trust cached state. A mutation during the read bumps
  // mutationSeq so the response is discarded instead of clobbering the
  // newer DB state.
  const mutationSeq = useRef(0);
  useEffect(() => {
    const pid = product?._id;
    if (!pid) return;
    const seq = mutationSeq.current;
    let alive = true;
    api.etsyProducts
      .get(pid)
      .then((res) => {
        if (!alive || seq !== mutationSeq.current || res.data._id !== pid) return;
        onProductUpdate(res.data);
      })
      .catch(() => {
        /* silent — the snapshot stays until the next mutation/open */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onProductUpdate is a page-level callback
  }, [product?._id]);

  // ← / → switch images while the dialog is open. The listener is re-attached
  // on every render so the closures stay fresh after each image switch.
  const canNavigate = images.length > 1;
  useEffect(() => {
    if (!product || !canNavigate) return;
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
        setIndex((i) => (i - 1 + images.length) % images.length);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setIndex((i) => (i + 1) % images.length);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function navigate(delta: -1 | 1) {
    if (!canNavigate) return;
    setIndex((i) => (i + delta + images.length) % images.length);
  }

  if (!product) return null;

  const md = product.metadata;
  const price = typeof md.price === "number" ? md.price : undefined;
  const upscales = image?.upscales ?? [];
  const activeUpscale = variant !== VARIANT_ORIGINAL ? upscales.find((u) => u._id === variant) : undefined;
  const previewSrc = image
    ? activeUpscale
      ? activeUpscale.url
      : image.image_link
    : "";
  const stampVisible = product.used_in_etsy;

  function patchImageIn(product: EtsyProduct, imageId: string | undefined, patch: Partial<EtsyProductImage>): EtsyProduct {
    return {
      ...product,
      images: product.images.map((im) => (im._id === imageId ? { ...im, ...patch } : im)),
    };
  }

  async function toggleListed() {
    const next = !product!.used_in_etsy;
    mutationSeq.current += 1;
    setBusyStamp(true);
    try {
      const res = await api.etsyProducts.update(product!._id, { used_in_etsy: next });
      onProductUpdate(res.data);
      toast({
        title: next ? "Marked as listed" : "Unlisted",
        description: next ? "The product is flagged as published on Etsy." : "Flag removed.",
      });
    } catch (e: unknown) {
      const msg = (e as { payload?: { message?: string } })?.payload?.message || "The stamp was not applied.";
      toast({ variant: "destructive", title: "Update failed", description: msg });
    } finally {
      setBusyStamp(false);
    }
  }

  /** Pause / reactivate the CURRENT image (upscale eligibility). */
  async function toggleActive() {
    if (!image?._id) return;
    const next = image.active === false;
    mutationSeq.current += 1;
    setBusyStatus(true);
    try {
      const res = await api.etsyProducts.images.update(product!._id, image._id, { active: next });
      onProductUpdate(res.data);
      toast({
        title: next ? "Image reactivated" : "Image paused",
        description: next
          ? "Eligible again for the next Etsy upscale batch run."
          : "Excluded from every Etsy upscale batch run until reactivated.",
      });
    } catch (e: unknown) {
      const msg = (e as { payload?: { message?: string } })?.payload?.message || "The status was not applied.";
      toast({ variant: "destructive", title: "Update failed", description: msg });
    } finally {
      setBusyStatus(false);
    }
  }

  async function dismissError() {
    if (!image?._id) return;
    mutationSeq.current += 1;
    setBusyDismiss(true);
    try {
      const res = await api.etsyProducts.images.update(product!._id, image._id, { error_message: "" });
      onProductUpdate(res.data);
      toast({ title: "Error dismissed", description: "The failure message was cleared." });
    } catch (e: unknown) {
      const msg = (e as { payload?: { message?: string } })?.payload?.message || "The message was not cleared.";
      toast({ variant: "destructive", title: "Update failed", description: msg });
    } finally {
      setBusyDismiss(false);
    }
  }

  async function download() {
    if (!image) return;
    setDownloading(true);
    try {
      await api.etsyProducts.images.download(product!, image, safeIndex);
      toast({ title: "Downloaded", description: "Image saved to your downloads." });
    } catch (e: unknown) {
      const msg = (e as { payload?: { message?: string } })?.payload?.message || "Could not download the image.";
      toast({ variant: "destructive", title: "Download failed", description: msg });
    } finally {
      setDownloading(false);
    }
  }

  async function downloadUpscale(u: Upscale) {
    if (!image?._id) return;
    setBusyUpscaleId(u._id);
    try {
      await api.etsyProducts.upscales.download(product!, image, safeIndex, u);
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
    if (!image?._id) return;
    mutationSeq.current += 1;
    setBusyUpscaleId(u._id);
    try {
      await api.etsyProducts.upscales.remove(product!._id, image._id, u._id);
      const updated = patchImageIn(product!, image._id, {
        upscales: upscales.filter((x) => x._id !== u._id),
      });
      if (variant === u._id) setVariant(VARIANT_ORIGINAL);
      onProductUpdate(updated);
      toast({ title: "Upscaled variant deleted", description: `×${u.scale} variant removed from this image.` });
    } catch (e: unknown) {
      const msg = (e as { payload?: { message?: string } })?.payload?.message || "Try again in a moment.";
      toast({ variant: "destructive", title: "Delete failed", description: msg });
    } finally {
      setBusyUpscaleId(null);
      setConfirmUpscaleDelete(null);
    }
  }

  return (
    <Dialog open={!!product} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 rounded-none border-ink bg-surface p-0 shadow-[var(--shadow-hard)] sm:max-w-4xl">
        <div className="grid max-h-[85vh] overflow-hidden md:grid-cols-[minmax(0,1.35fr)_minmax(300px,1fr)]">
          {/* ── LEFT: image-by-image viewer ── */}
          <div className="relative flex flex-col border-b border-line bg-muted md:border-b-0 md:border-r">
            <div className="flex flex-1 items-center justify-center">
              {!image ? (
                <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 text-ink-muted">
                  <Images className="h-8 w-8" aria-hidden />
                  <span className="font-mono text-[11px] uppercase tracking-wider">no image in this product</span>
                </div>
              ) : broken ? (
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
                  alt={
                    activeUpscale
                      ? `${image.caption || `Image ${safeIndex + 1}`} — upscaled ×${activeUpscale.scale}`
                      : image.caption || `Image ${safeIndex + 1} of ${images.length}`
                  }
                  onError={() => setBroken(true)}
                  className={cn(
                    "max-h-[42vh] w-full object-contain md:max-h-[62vh]",
                    image.role === "cover" && "bg-muted",
                  )}
                />
              )}
              {stampVisible && (
                <span className="stamp stamp-thunk pointer-events-none absolute" data-testid="detail-stamp">
                  Listed on Etsy
                </span>
              )}

              {/* Looping prev/next navigation (arrows + position counter) */}
              {canNavigate && (
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
                    aria-label={`Image ${safeIndex + 1} of ${images.length}`}
                    className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 border border-line-strong bg-surface/90 px-2 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-ink shadow-[var(--shadow-hard-sm)]"
                  >
                    {safeIndex + 1} / {images.length}
                  </span>
                </>
              )}
            </div>

            {/* Original / upscaled variant switcher — same as the images detail */}
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
                      : "bg-surface text-ink hover:border-ink",
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
                        : "bg-surface text-ink hover:border-ink",
                    )}
                  >
                    <ZoomIn className="mr-1 inline h-3 w-3" aria-hidden />×{u.scale}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── RIGHT: metadata + info ── */}
          <div className="flex min-h-0 flex-col">
            <DialogHeader className="border-b border-line p-4 pr-10">
              <DialogTitle className="text-left font-display text-lg font-bold uppercase leading-tight tracking-wide">
                {md.title || "Untitled product"}
              </DialogTitle>
              <DialogDescription className="sr-only">Etsy product details</DialogDescription>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="chip border-line-strong text-ink">{etsyProductTypeLabel(product.product_type)}</span>
                <span className="chip">
                  {images.length} image{images.length === 1 ? "" : "s"}
                </span>
                {images.filter((im) => im.role === "page").length > 0 && (
                  <span className="chip" title="product pages — cover excluded">
                    {images.filter((im) => im.role === "page").length} pages
                  </span>
                )}
                {images.filter((im) => im.role === "marketing").length > 0 && (
                  <span className="chip border-brand/50 text-brand" title="announcement images for the Etsy listing">
                    {images.filter((im) => im.role === "marketing").length} promo
                  </span>
                )}
                {price !== undefined && <span className="chip">${price.toFixed(2)}</span>}
                {upscales.length > 0 && (
                  <span className="chip border-brand/60 text-brand" title={`${upscales.length} upscaled variant(s) on this image`}>
                    <ZoomIn className="mr-1 inline h-3 w-3" aria-hidden />×{upscales.length}
                  </span>
                )}
                {product.used_in_etsy && <span className="chip border-stamp/60 text-stamp">listed on Etsy</span>}
                <CopyButton value={md.title} label="title" className="ml-1" />
              </div>
            </DialogHeader>

            <div ref={metaScrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {/* ── current image info ── */}
              {image && (
                <section>
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="eyebrow">
                      Image {safeIndex + 1} / {images.length}
                      {image.role && (
                        <span
                          className={cn(
                            "ml-1.5 font-mono text-[10px] normal-case tracking-normal",
                            image.role === "marketing" ? "font-bold text-brand" : "text-ink-muted",
                          )}
                        >
                          · {etsyImageRoleLabel(image.role)}
                        </span>
                      )}
                    </h4>
                    <span className="font-mono text-[10px] text-ink-muted">
                      {upscales.length} upscale{upscales.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="mt-1.5 space-y-2">
                    {image.caption && (
                      <p className="border border-line bg-paper p-2.5 font-mono text-[11.5px] leading-relaxed text-ink">
                        {image.caption}
                      </p>
                    )}

                    {image.error_message && (
                      <div className="border border-danger bg-danger-soft p-3" data-testid="error-banner">
                        <div className="flex items-center justify-between gap-2">
                          <h5 className="eyebrow flex items-center gap-1.5 text-danger">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                            Last upscale error
                          </h5>
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
                      </div>
                    )}

                    {image.in_use === true && (
                      <p
                        className="flex items-center gap-2 border border-brand/40 bg-paper p-2.5 font-mono text-[11px] text-brand"
                        data-testid="in-use-banner"
                      >
                        <span className="h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden />
                        Claimed by an upscale worker right now — the result will appear in Upscales when done.
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-ink-muted">
                      {image.ratio && <span className="chip">{image.ratio}</span>}
                      {image.quality && <span className="chip">{image.quality}</span>}
                      {image._id && (
                        <span
                          className="flex items-center gap-1"
                          title="Ids for the « Upscale — single image » workflow (source: etsy-product-image)"
                        >
                          <CopyButton value={image._id} label={`image id ${image._id.slice(0, 8)}…`} />
                          <CopyButton value={product._id} label={`product id ${product._id.slice(0, 8)}…`} />
                          <span className="sr-only">copy ids for the single-image upscale workflow</span>
                        </span>
                      )}
                    </div>

                    {image.prompt && (
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <h5 className="eyebrow">Generation prompt</h5>
                          <CopyButton value={image.prompt} label="prompt" />
                        </div>
                        <p className="mt-1 max-h-28 overflow-y-auto border border-line bg-paper p-2.5 font-mono text-[11.5px] leading-relaxed text-ink-muted">
                          {image.prompt}
                        </p>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* ── upscaled variants of the CURRENT image ── */}
              {image && (
                <section>
                  <h4 className="eyebrow">Upscales ({upscales.length})</h4>
                  {upscales.length === 0 ? (
                    <p className="mt-1.5 border border-line bg-paper p-2.5 font-mono text-[11px] leading-relaxed text-ink-muted">
                      No upscaled variant on this image yet — the daily &quot;Upscale — batch Etsy&quot; GitHub
                      Actions job adds Real-ESRGAN upscales here automatically (see docs/UPSCALE.md).
                    </p>
                  ) : (
                    <ul className="mt-1.5 space-y-1.5">
                      {upscales.map((u) => (
                        <li
                          key={u._id}
                          className={cn(
                            "border bg-paper p-2.5",
                            variant === u._id ? "border-ink" : "border-line",
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
                            {product.used_in_etsy && (
                              <span
                                className="chip ml-auto border-stamp/60 text-stamp"
                                title="The whole product is listed on Etsy — an upscale is the same image as its original, it has no stamp of its own"
                                data-testid="etsy-upscale-follows-product"
                              >
                                listed product
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
              )}

              {/* ── Etsy listing metadata (shared by the whole product) ── */}
              <section>
                <div className="flex items-center justify-between gap-2">
                  <h4 className="eyebrow">Etsy listing metadata</h4>
                  <span className="font-mono text-[10px] text-ink-muted">
                    shared · title ≤ 140 · 13 tags ≤ 20 chars
                  </span>
                </div>
                <div className="mt-1.5 space-y-2">
                  <div className="border border-line bg-paper p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <h5 className="eyebrow">Description</h5>
                      <CopyButton value={md.description} label="description" />
                    </div>
                    <p className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-ink-muted">
                      {md.description}
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h5 className="eyebrow flex items-center gap-1">
                        <Tag className="h-3 w-3" aria-hidden /> Tags ({md.tags?.length ?? 0}/13)
                      </h5>
                      <CopyButton value={(md.tags ?? []).join(",")} label="tags (comma separated)" />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(md.tags ?? []).map((t) => (
                        <span key={t} className="border border-line bg-paper px-1.5 py-0.5 font-mono text-[11px] text-ink">
                          {t}
                        </span>
                      ))}
                      {!md.tags?.length && (
                        <span className="font-mono text-[11px] text-ink-muted">No tags.</span>
                      )}
                    </div>
                  </div>

                  {md.category && (
                    <p className="font-mono text-[11px] text-ink-muted">
                      category <span className="font-semibold text-ink">{md.category}</span>
                    </p>
                  )}

                  {product.file_link && (
                    <p className="flex items-center gap-1.5 font-mono text-[11px]">
                      <FileDown className="h-3 w-3 text-brand" aria-hidden />
                      <a href={product.file_link} target="_blank" rel="noreferrer" className="break-all text-brand hover:underline">
                        deliverable file (PDF/ZIP)
                      </a>
                    </p>
                  )}
                </div>
              </section>

              {/* ── session + record info ── */}
              <section className="space-y-1.5 font-mono text-[11.5px] text-ink-muted">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="eyebrow">Session</h4>
                  <Link
                    href={`/sessions/${product.session_id}`}
                    className="flex items-center gap-1 text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand"
                    onClick={onClose}
                  >
                    {sessionTitle ? sessionTitle.slice(0, 24) : product.session_id.slice(0, 12)}
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </Link>
                </div>
                <p>created {formatDateTime(product.createdAt)}</p>
                <p>updated {formatDateTime(product.updatedAt)}</p>
                <p className="truncate">product id {product._id}</p>
              </section>
            </div>

            {/* ── footer actions ── */}
            <div className="flex flex-wrap items-center gap-2 border-t border-line bg-paper p-3">
              <StampToggle
                used={product.used_in_etsy}
                busy={busyStamp}
                onToggle={toggleListed}
                label="Mark the product as listed on Etsy"
              />
              {image && (
                <StatusToggle
                  active={image.active !== false}
                  disabled={busyStatus || !image._id}
                  onToggle={toggleActive}
                  label={
                    image.active !== false
                      ? "Pause this image (exclude from Etsy batch runs)"
                      : "Reactivate this image"
                  }
                />
              )}
              <button
                type="button"
                onClick={download}
                disabled={downloading || !image}
                className="flex h-[34px] items-center gap-2 bg-brand px-3.5 font-display text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-brand-deep disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-brand"
              >
                <Download className="h-4 w-4" aria-hidden />
                {downloading ? "Downloading…" : activeUpscale ? "Download original" : "Download"}
              </button>
              <button
                type="button"
                onClick={() => onEdit(product)}
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
        title="Delete this Etsy product?"
        description={`"${md.title}" and its ${images.length} image${images.length === 1 ? "" : "s"} will be removed from the database. The generated files stay wherever they are hosted — this only removes the record.`}
        confirmLabel="Delete product"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete(product);
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
