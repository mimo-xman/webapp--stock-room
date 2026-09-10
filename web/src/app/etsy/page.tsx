"use client";

/**
 * Etsy products page — the digital products sold on Etsy (coloring books,
 * invitations, wall-art sets…): one product = one or many images (cover,
 * pages, marketing/announcement images) + one shared listing metadata block.
 */

import { useState } from "react";
import { Images, Plus } from "lucide-react";
import { TopBar } from "@/components/app/TopBar";
import { FilterBar, type FilterDef } from "@/components/app/FilterBar";
import { PaginationBar } from "@/components/app/PaginationBar";
import { EmptyState } from "@/components/app/EmptyState";
import { EtsyProductDetailDialog } from "@/components/app/EtsyProductDetailDialog";
import { EtsyProductFormDialog } from "@/components/app/EtsyProductFormDialog";
import { EtsyProductGrid } from "@/components/app/EtsyProductGrid";
import { EtsyZipDialog } from "@/components/app/EtsyZipDialog";
import { useList, useSessionOptions } from "@/hooks/use-list";
import { api } from "@/lib/api";
import { ETSY_PRODUCT_TYPES, ETSY_SORTS } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import type { EtsyProduct } from "@/lib/types";

export default function EtsyPage() {
  const { toast } = useToast();
  // URL sync: the whole list state lives in the page URL
  // (/etsy?page=2&product_type=coloring_book&used_in_etsy=true…).
  const list = useList(
    (p) => api.etsyProducts.list(p),
    undefined,
    { filterKeys: ["session_id", "product_type", "used_in_etsy"] },
  );
  const sessionOptions = useSessionOptions();

  const [detail, setDetail] = useState<EtsyProduct | null>(null);
  const [editing, setEditing] = useState<EtsyProduct | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [zipProduct, setZipProduct] = useState<EtsyProduct | null>(null);
  const [zipDialogOpen, setZipDialogOpen] = useState(false);

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
    setEditing((e) => (e && e._id === updated._id ? updated : e));
    list.patchLocal(updated._id, updated); // full fresh doc — DB state, in place
  }

  function handleSaved(saved: EtsyProduct) {
    handleProductUpdate(saved);
    // the list may show counts / order that changed — refetch.
    list.reload();
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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold uppercase tracking-tight">Etsy products</h1>
            <p className="font-mono text-xs text-ink-muted">
              {list.pagination ? `${list.pagination.total} digital product${list.pagination.total === 1 ? "" : "s"} for Etsy` : "…"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="flex h-10 items-center gap-2 bg-brand px-4 font-display text-sm font-bold uppercase tracking-widest text-white shadow-[var(--shadow-hard-sm)] transition-colors hover:bg-brand-deep focus-visible:outline-2 focus-visible:outline-brand"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New product
          </button>
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
          <EtsyProductGrid products={[]} loading />
        ) : products.length === 0 ? (
          <EmptyState
            icon={<Images className="h-6 w-6" aria-hidden />}
            title={hasFilters ? "No product matches" : "No Etsy products yet"}
            hint={
              hasFilters
                ? "Clear the filters or try another search."
                : "Products arrive from Etsy agent runs (coloring books, invitations…) — or create one manually."
            }
            action={
              !hasFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                  className="flex h-10 items-center gap-2 bg-brand px-4 font-display text-sm font-bold uppercase tracking-widest text-white transition-colors hover:bg-brand-deep"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Create the first product
                </button>
              )
            }
          />
        ) : (
          <EtsyProductGrid
            products={products}
            onOpen={openDetail}
            onDownloadZip={(p) => {
              setZipProduct(p);
              setZipDialogOpen(true);
            }}
          />
        )}

        <PaginationBar pagination={list.pagination} onChange={list.updateParams} />
      </main>

      <EtsyProductDetailDialog
        product={detail}
        onClose={() => setDetail(null)}
        onProductUpdate={handleProductUpdate}
        onEdit={(p) => {
          setDetail(null);
          setEditing(p);
          setFormOpen(true);
        }}
        onDelete={deleteProduct}
      />

      <EtsyZipDialog product={zipProduct} open={zipDialogOpen} onOpenChange={setZipDialogOpen} />

      <EtsyProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        product={editing}
        sessionOptions={sessionOptions}
        onSaved={handleSaved}
      />
    </>
  );
}
