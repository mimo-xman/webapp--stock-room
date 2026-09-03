"use client";

/**
 * Images page — the full contact sheet across all sessions.
 */

import { useState } from "react";
import { Plus, Images } from "lucide-react";
import { TopBar } from "@/components/app/TopBar";
import { FilterBar, type FilterDef } from "@/components/app/FilterBar";
import { PaginationBar } from "@/components/app/PaginationBar";
import { ImageGrid } from "@/components/app/ImageGrid";
import { ImageDetailDialog } from "@/components/app/ImageDetailDialog";
import { ImageFormDialog } from "@/components/app/ImageFormDialog";
import { EmptyState } from "@/components/app/EmptyState";
import { useList, useSessionOptions } from "@/hooks/use-list";
import { api } from "@/lib/api";
import { IMAGE_SORTS, CATEGORIES, QUALITIES } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import type { StockImage } from "@/lib/types";

export default function ImagesPage() {
  const { toast } = useToast();
  const list = useList((p) => api.images.list(p));
  const sessionOptions = useSessionOptions();

  const [detail, setDetail] = useState<StockImage | null>(null);
  const [editing, setEditing] = useState<StockImage | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [thunk, setThunk] = useState(0);

  const images = list.items as StockImage[];

  const filterDefs: FilterDef[] = [
    { key: "session_id", label: "Session", options: sessionOptions },
    {
      key: "category",
      label: "Category",
      options: CATEGORIES.map((c) => ({ value: c, label: c })),
    },
    {
      key: "used_in_adobe_stock",
      label: "Adobe Stock",
      options: [
        { value: "true", label: "Used" },
        { value: "false", label: "Not used" },
      ],
    },
    { key: "quality", label: "Quality", options: QUALITIES.map((q) => ({ value: q, label: q })) },
  ];

  function openDetail(image: StockImage) {
    setDetail(images.find((i) => i._id === image._id) || image);
  }

  async function toggleUsed(image: StockImage) {
    const next = !image.used_in_adobe_stock;
    if (detail?._id === image._id) setDetail({ ...detail, used_in_adobe_stock: next });
    list.patchLocal(image._id, { used_in_adobe_stock: next });
    if (next) setThunk((t) => t + 1);
    try {
      await api.images.update(image._id, { used_in_adobe_stock: next });
    } catch {
      list.patchLocal(image._id, { used_in_adobe_stock: !next });
      toast({ variant: "destructive", title: "Update failed", description: "The stamp was not applied." });
    }
  }

  async function deleteImage(image: StockImage) {
    try {
      await api.images.remove(image._id);
      setDetail(null);
      toast({ title: "Image deleted", description: image.title });
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
            <h1 className="font-display text-3xl font-bold uppercase tracking-tight">Images</h1>
            <p className="font-mono text-xs text-ink-muted">
              {list.pagination ? `${list.pagination.total} image${list.pagination.total === 1 ? "" : "s"} in stock` : "…"}
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
            Add image
          </button>
        </div>

        <FilterBar
          params={list.params}
          onChange={list.updateParams}
          onFilter={list.updateFilter}
          onReset={list.reset}
          searchPlaceholder="Search titles, prompts, keywords…"
          filters={filterDefs}
          sortOptions={IMAGE_SORTS}
        />

        {list.error && (
          <p className="border border-danger bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
            {list.error}
          </p>
        )}

        {list.loading ? (
          <ImageGrid images={[]} loading onOpen={openDetail} onToggleUsed={toggleUsed} />
        ) : images.length === 0 ? (
          <EmptyState
            icon={<Images className="h-6 w-6" aria-hidden />}
            title={hasFilters ? "No image matches" : "No images yet"}
            hint={
              hasFilters
                ? "Clear the filters or try another search."
                : "Images arrive from agent runs. You can also register one manually."
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
                  Register the first image
                </button>
              )
            }
          />
        ) : (
          <ImageGrid images={images} onOpen={openDetail} onToggleUsed={toggleUsed} thunkKey={thunk} />
        )}

        <PaginationBar pagination={list.pagination} onChange={list.updateParams} />
      </main>

      <ImageDetailDialog
        image={detail}
        onClose={() => setDetail(null)}
        onToggleUsed={toggleUsed}
        onEdit={(img) => {
          setDetail(null);
          setEditing(img);
          setFormOpen(true);
        }}
        onDelete={deleteImage}
      />

      <ImageFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        image={editing}
        sessionOptions={sessionOptions}
        onSaved={list.reload}
      />
    </>
  );
}
