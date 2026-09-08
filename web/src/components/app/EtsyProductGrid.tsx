"use client";

/**
 * Etsy product card grid — shared by /etsy and the session detail page.
 *
 * One card = one product: cover image, title, type chip, page count AND the
 * marketing (announcement) image count — the listing photos that sell the
 * product — plus price and tag count.
 */

import { Images, Tag, Layers, Megaphone } from "lucide-react";
import { ETSY_PRODUCT_TYPES } from "@/lib/constants";
import type { EtsyProduct } from "@/lib/types";
import { cn } from "@/lib/utils";

export function EtsyProductGrid({
  products,
  loading = false,
  onOpen,
}: {
  products: EtsyProduct[];
  loading?: boolean;
  onOpen?: (product: EtsyProduct) => void;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton aspect-[3/4] border border-line" aria-hidden />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((p) => {
        const cover = p.images.find((im) => im.role === "cover") ?? p.images[0];
        const pageCount = p.images.filter((im) => im.role === "page").length;
        const marketingCount = p.images.filter((im) => im.role === "marketing").length;
        const otherCount = p.images.filter(
          (im) => im.role !== "cover" && im.role !== "page" && im.role !== "marketing",
        ).length;
        return (
          <article
            key={p._id}
            className="group flex cursor-pointer flex-col border border-line-strong bg-surface transition-shadow hover:border-ink hover:shadow-[var(--shadow-hard)] focus-visible:outline-2 focus-visible:outline-brand"
            onClick={() => onOpen?.(p)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen?.(p);
              }
            }}
            tabIndex={0}
            role="button"
            aria-label={`Open ${p.metadata.title}`}
          >
            <div className="relative aspect-[3/4] overflow-hidden bg-muted">
              {cover ? (
                <img
                  src={cover.image_link}
                  alt={p.metadata.title}
                  loading="lazy"
                  className={cn(
                    "h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]",
                    cover.role === "cover" && "object-contain",
                    p.used_in_etsy && "opacity-95",
                  )}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-ink-muted">
                  <Images className="h-6 w-6" aria-hidden />
                </div>
              )}
              {p.used_in_etsy && (
                <span className="stamp pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px]">
                  Listed
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-3">
              <h3 className="line-clamp-2 text-sm font-medium leading-snug">{p.metadata.title}</h3>
              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                <span className="chip max-w-full truncate border-line-strong text-ink">
                  {ETSY_PRODUCT_TYPES.find((t) => t.value === p.product_type)?.label ?? p.product_type}
                </span>
                {pageCount > 0 && (
                  <span className="chip" title={`${pageCount} product page(s) — cover excluded`}>
                    <Layers className="mr-0.5 inline h-3 w-3" aria-hidden />
                    {pageCount} pages
                  </span>
                )}
                {marketingCount > 0 && (
                  <span
                    className="chip border-brand/50 text-brand"
                    title={`${marketingCount} announcement image(s) for the Etsy listing`}
                  >
                    <Megaphone className="mr-0.5 inline h-3 w-3" aria-hidden />
                    {marketingCount} promo
                  </span>
                )}
                {otherCount > 0 && (
                  <span className="chip" title={`${otherCount} asset/preview image(s)`}>
                    +{otherCount}
                  </span>
                )}
                {typeof p.metadata.price === "number" && (
                  <span className="chip border-brand/50 text-brand">${p.metadata.price.toFixed(2)}</span>
                )}
                <span
                  className="ml-auto flex items-center gap-1 font-mono text-[10px] text-ink-muted"
                  title={(p.metadata.tags ?? []).join(", ")}
                >
                  <Tag className="h-3 w-3" aria-hidden />
                  {p.metadata.tags?.length ?? 0}
                </span>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
