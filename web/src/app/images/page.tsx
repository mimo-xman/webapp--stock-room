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
import { useCsvSelection } from "@/hooks/use-csv-selection";
import { api } from "@/lib/api";
import { buildAdobeStockCsv, downloadCsvFile } from "@/lib/csv";
import { IMAGE_SORTS, CATEGORIES, QUALITIES } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import { SelectionBar } from "@/components/app/SelectionBar";
import type { StockImage } from "@/lib/types";

export default function ImagesPage() {
  const { toast } = useToast();
  const list = useList((p) => api.images.list(p));
  const sessionOptions = useSessionOptions();
  const csvSel = useCsvSelection();
  const [csvBuilding, setCsvBuilding] = useState(false);

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
      key: "active",
      label: "Status",
      options: [
        { value: "true", label: "Active" },
        { value: "false", label: "Paused (failed)" },
      ],
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
    {
      key: "has_upscales",
      label: "Upscales",
      options: [
        { value: "true", label: "With upscales" },
        { value: "false", label: "Without upscales" },
      ],
    },
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
      if (detail?._id === image._id) setDetail({ ...detail, used_in_adobe_stock: !next });
      toast({ variant: "destructive", title: "Update failed", description: "The stamp was not applied." });
    }
  }

  /** Detail dialog reports upscale mutations (mark used / delete) and
   *  batch-status changes (pause / error dismissed) with the updated image —
   *  refresh the detail state and the grid row in place. */
  function handleImageUpdate(updated: StockImage) {
    setDetail((d) => (d && d._id === updated._id ? updated : d));
    list.patchLocal(updated._id, {
      upscales: updated.upscales,
      active: updated.active,
      in_use: updated.in_use,
      in_use_at: updated.in_use_at,
      error_message: updated.error_message,
    });
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

  /** Build + download the Adobe Stock metadata CSV for the selection
   *  (originals and/or upscaled variants — selection survives pagination). */
  function downloadCsv() {
    setCsvBuilding(true);
    try {
      const { csv, rows, warnings } = buildAdobeStockCsv(csvSel.list);
      downloadCsvFile(csv, `adobe-stock-upload-${new Date().toISOString().slice(0, 10)}.csv`);
      toast({
        title: "Adobe Stock CSV downloaded",
        description: warnings.length
          ? `${rows} row(s). ⚠ ${warnings[0]}${warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ""}`
          : `${rows} row(s) — upload the images to Adobe Stock, then this CSV.`,
      });
    } finally {
      setCsvBuilding(false);
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
          <ImageGrid
            images={images}
            onOpen={openDetail}
            onToggleUsed={toggleUsed}
            thunkKey={thunk}
            selectionFor={(image) => ({
              selected: csvSel.isSelected(image._id),
              onToggle: (img) => csvSel.toggle(img),
            })}
          />
        )}

        <PaginationBar pagination={list.pagination} onChange={list.updateParams} />

        <SelectionBar
          count={csvSel.count}
          disabled={csvBuilding}
          onDownload={downloadCsv}
          onClear={csvSel.clear}
        />
      </main>

      <ImageDetailDialog
        image={detail}
        onClose={() => setDetail(null)}
        onToggleUsed={toggleUsed}
        onImageUpdate={handleImageUpdate}
        selection={{ isSelected: csvSel.isSelected, toggle: csvSel.toggle }}
        nav={{ images, onNavigate: openDetail }}
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
