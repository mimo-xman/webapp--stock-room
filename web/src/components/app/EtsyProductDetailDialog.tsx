"use client";

/**
 * Etsy product detail dialog — cover + page gallery, the product's Etsy
 * listing metadata (title / description / tags / category / price) with copy
 * buttons, per-image download, the "listed on Etsy" stamp, edit, delete.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowRight,
  CheckCircle2,
  Download,
  FileDown,
  ImageOff,
  Pencil,
  Stamp,
  Tag,
  Trash2,
} from "lucide-react";
import { CopyButton } from "./CopyButton";
import { StampToggle } from "./StampToggle";
import { ConfirmDialog } from "./ConfirmDialog";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { etsyProductTypeLabel } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import type { EtsyProduct } from "@/lib/types";
import { cn } from "@/lib/utils";

interface EtsyProductDetailDialogProps {
  product: EtsyProduct | null;
  onClose: () => void;
  onProductUpdate: (product: EtsyProduct) => void;
  onEdit: (product: EtsyProduct) => void;
  onDelete: (product: EtsyProduct) => void;
  sessionTitle?: string;
}

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
  const [busyImage, setBusyImage] = useState<string | null>(null);
  const { toast } = useToast();

  const [prevId, setPrevId] = useState<string>("");
  if (product && prevId !== product._id) {
    setPrevId(product._id);
  }

  // re-sync when the parent sends an updated product
  useEffect(() => {
    if (product) setPrevId(product._id);
  }, [product]);

  if (!product) return null;

  const images = product.images ?? [];
  const cover = images.find((im) => im.role === "cover") ?? images[0];
  const pages = images.filter((im) => im !== cover);
  const md = product.metadata;
  const price = typeof md.price === "number" ? md.price : undefined;

  async function toggleListed() {
    if (!product) return;
    const next = !product.used_in_etsy;
    setBusyStamp(true);
    try {
      const res = await api.etsyProducts.update(product._id, { used_in_etsy: next });
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

  async function downloadImage(index: number) {
    const im = images[index];
    if (!im) return;
    setBusyImage(String(im._id ?? index));
    try {
      // stream the raw URL through the browser (products have no proxy route)
      const res = await fetch(im.image_link);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const ext = (im.image_link.split("?")[0].split(".").pop() || "png").toLowerCase().slice(0, 5);
      const slug = (im.caption || md.title || "product")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 50);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug || "image"}-${index + 1}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Downloaded", description: "Page saved to your downloads." });
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Download failed", description: (e as Error).message });
    } finally {
      setBusyImage(null);
    }
  }

  return (
    <Dialog open={!!product} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-y-auto rounded-none border-ink bg-surface p-0 shadow-[var(--shadow-hard)] sm:max-w-3xl">
        <DialogHeader className="border-b border-line p-4 pr-10">
          <DialogTitle className="text-left font-display text-lg font-bold uppercase leading-tight tracking-wide">
            {md.title || "Untitled product"}
          </DialogTitle>
          <DialogDescription className="sr-only">Etsy product details</DialogDescription>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="chip border-line-strong text-ink">{etsyProductTypeLabel(product.product_type)}</span>
            <span className="chip">{images.length} image{images.length === 1 ? "" : "s"}</span>
            {price !== undefined && <span className="chip">${price.toFixed(2)}</span>}
            {product.used_in_etsy && <span className="chip border-stamp/60 text-stamp">listed on Etsy</span>}
            <CopyButton value={md.title} label="title" className="ml-1" />
          </div>
        </DialogHeader>

        <div className="space-y-4 p-4">
          {/* cover */}
          {cover && (
            <section>
              <h4 className="eyebrow">Cover</h4>
              <div className="mt-1.5 border border-line bg-paper">
                <ProductImage image={cover} />
              </div>
            </section>
          )}

          {/* pages gallery */}
          {pages.length > 0 && (
            <section>
              <h4 className="eyebrow">Pages / assets ({pages.length})</h4>
              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {pages.map((im, i) => (
                  <div key={im._id ?? i} className="border border-line bg-paper">
                    <ProductImage image={im} />
                    <div className="flex items-center justify-between gap-1 p-1.5">
                      <span className="truncate font-mono text-[10px] text-ink-muted" title={im.caption}>
                        {im.caption || `#${i + 1}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => downloadImage(images.indexOf(im))}
                        disabled={busyImage === (im._id ?? String(i))}
                        className="flex h-6 w-6 items-center justify-center border border-line-strong bg-surface text-ink-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-brand"
                        aria-label={`Download ${im.caption || `page ${i + 1}`}`}
                      >
                        <Download className="h-3 w-3" aria-hidden />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Etsy listing metadata */}
          <section>
            <div className="flex items-center justify-between gap-2">
              <h4 className="eyebrow">Etsy listing metadata</h4>
              <span className="font-mono text-[10px] text-ink-muted">
                title ≤ 140 · 13 tags ≤ 20 chars
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
            <p className="truncate">id {product._id}</p>
          </section>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-paper p-3">
          <StampToggle
            used={product.used_in_etsy}
            busy={busyStamp}
            onToggle={toggleListed}
            label="Mark the product as listed on Etsy"
          />
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
    </Dialog>
  );
}

/** One gallery image with broken-preview handling. */
function ProductImage({ image }: { image: EtsyProduct["images"][number] }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1.5 bg-muted text-ink-muted">
        <ImageOff className="h-5 w-5" aria-hidden />
        <span className="font-mono text-[9.5px] uppercase tracking-wider">unreachable</span>
      </div>
    );
  }
  return (
    <img
      src={image.image_link}
      alt={image.caption || "product image"}
      loading="lazy"
      onError={() => setBroken(true)}
      className={cn("aspect-[3/4] w-full object-cover", image.role === "cover" && "object-contain bg-muted")}
    />
  );
}
