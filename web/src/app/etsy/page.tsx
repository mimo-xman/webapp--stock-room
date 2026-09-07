"use client";

/**
 * Etsy products page — the digital products sold on Etsy (coloring books,
 * invitations, wall-art sets…): one product = one or many images + one shared
 * listing metadata block.
 */

import { useState } from "react";
import { Tag, Images } from "lucide-react";
import { TopBar } from "@/components/app/TopBar";
import { FilterBar, type FilterDef } from "@/components/app/FilterBar";
import { PaginationBar } from "@/components/app/PaginationBar";
import { EmptyState } from "@/components/app/EmptyState";
import { EtsyProductDetailDialog } from "@/components/app/EtsyProductDetailDialog";
import { useList, useSessionOptions } from "@/hooks/use-list";
import { api } from "@/lib/api";
import { ETSY_PRODUCT_TYPES, ETSY_SORTS } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import type { EtsyProduct } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function EtsyPage() {
  const { toast } = useToast();
  const list = useList((p) => api.etsyProducts.list(p));
  const sessionOptions = useSessionOptions();

  const [detail, setDetail] = useState<EtsyProduct | null>(null);

  const products = list.items as EtsyProduct[];

  const filterDefs: FilterDef[] = [
    { key: "session_id", label: "Session", options: sessionOptions },
    {
      key: "product_type",
      label: "Type",
      options: ETSY_PRODUCT_TYPES.map((t) => ({ value: t.value, label: t.label })),
    },
    {
      key: "used_in_etsy",
      label: "Listing",
      options: [
        { value: "true", label: "Listed on Etsy" },
        { value: "false", label: "Not listed yet" },
      ],
    },
  ];

  function openDetail(product: EtsyProduct) {
    setDetail(products.find((p) => p._id === product._id) || product);
  }

  function handleProductUpdate(updated: EtsyProduct) {
    setDetail((d) => (d && d._id === updated._id ? updated : d));
    list.patchLocal(updated._id, {
      used_in_etsy: updated.used_in_etsy,
      metadata: updated.metadata,
      images: updated.images,
    });
  }

  async function deleteProduct(product: EtsyProduct) {
    try {
      await api.etsyProducts.remove(product._id);
      setDetail(null);
      toast({ title: "Product deleted", description: product.metadata.title });
      list.reload();
    } catch {
      toast({ variant: "destructive", title: "Delete failed", description: "Try again in a moment." });
    }
  }

  const hasFilters = list.params.search || Object.values(list.params.filters).some(Boolean);

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-tight">Etsy products</h1>
          <p className="font-mono text-xs text-ink-muted">
            {list.pagination ? `${list.pagination.total} digital product${list.pagination.total === 1 ? "" : "s"} for Etsy` : "…"}
          </p>
        </div>

        <FilterBar
          params={list.params}
          onChange={list.updateParams}
          onFilter={list.updateFilter}
          onReset={list.reset}
          searchPlaceholder="Search titles, descriptions, tags…"
          filters={filterDefs}
          sortOptions={ETSY_SORTS}
        />

        {list.error && (
          <p className="border border-danger bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
            {list.error}
          </p>
        )}

        {list.loading ? (
          <ProductGrid products={[]} loading />
        ) : products.length === 0 ? (
          <EmptyState
            icon={<Images className="h-6 w-6" aria-hidden />}
            title={hasFilters ? "No product matches" : "No Etsy products yet"}
            hint={
              hasFilters
                ? "Clear the filters or try another search."
                : "Products arrive from Etsy agent runs (coloring books, invitations…) — they bundle several images behind one listing."
            }
          />
        ) : (
          <ProductGrid products={products} onOpen={openDetail} />
        )}

        <PaginationBar pagination={list.pagination} onChange={list.updateParams} />
      </main>

      <EtsyProductDetailDialog
        product={detail}
        onClose={() => setDetail(null)}
        onProductUpdate={handleProductUpdate}
        onEdit={() => {
          toast({
            title: "Editing products",
            description: "Product metadata is written by the generation agent — use PATCH /api/etsy-products/:id for manual fixes.",
          });
        }}
        onDelete={deleteProduct}
      />
    </>
  );
}

// ── grid ─────────────────────────────────────────────────────────────────────

function ProductGrid({
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
        const pageCount = p.images.filter((im) => im.role !== "cover").length;
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
                {pageCount > 0 && <span className="chip">{pageCount} pages</span>}
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
