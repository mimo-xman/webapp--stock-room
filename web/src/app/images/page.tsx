"use client";

/**
 * Images page — the full contact sheet across all sessions.
 */

import { useEffect, useRef, useState } from "react";
import { Plus, Images } from "lucide-react";
import { TopBar } from "@/components/app/TopBar";
import { FilterBar, type FilterDef } from "@/components/app/FilterBar";
import { PaginationBar } from "@/components/app/PaginationBar";
import { ImageGrid } from "@/components/app/ImageGrid";
import { ImageDetailDialog } from "@/components/app/ImageDetailDialog";
import { ImageFormDialog } from "@/components/app/ImageFormDialog";
import { CsvPlatformDialog } from "@/components/app/CsvPlatformDialog";
import { EmptyState } from "@/components/app/EmptyState";
import { useList, useSessionOptions } from "@/hooks/use-list";
import { useCsvSelection, fetchFreshSelectionItems } from "@/hooks/use-csv-selection";
import { api } from "@/lib/api";
import { IMAGE_SORTS, CATEGORIES, QUALITIES, PLATFORMS } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import { SelectionBar } from "@/components/app/SelectionBar";
import { BulkSelectPanel } from "@/components/app/BulkSelectPanel";
import { BulkUsedDialog } from "@/components/app/BulkUsedDialog";
import type { PlatformId, StockImage } from "@/lib/types";
import type { CsvSelectionItem } from "@/lib/csv";

export default function ImagesPage() {
  const { toast } = useToast();
  // URL sync: the whole list state lives in the page URL
  // (/images?page=2&sort=used&category=Food…) — reload / Back restores it.
  const list = useList(
    (p) => api.images.list(p),
    undefined,
    { filterKeys: ["session_id", "category", "active", "used", "quality", "has_upscales"] },
  );
  const sessionOptions = useSessionOptions();
  const csvSel = useCsvSelection();
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);

  const [detail, setDetail] = useState<StockImage | null>(null);
  const [editing, setEditing] = useState<StockImage | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [thunk, setThunk] = useState(0);
  const [bulkBusy, setBulkBusy] = useState(false);
  /** Platform picker popup (opened by the SelectionBar's stamp buttons). */
  const [bulkMode, setBulkMode] = useState<"mark" | "unmark" | null>(null);
  /** Fresh-from-the-DB copy of the selection for the popup counts. */
  const [bulkItems, setBulkItems] = useState<CsvSelectionItem[] | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

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
      key: "used",
      label: "Usage",
      options: [
        { value: "true", label: "Used (any platform)" },
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

  /** Quick stamp: not used anywhere → mark Adobe Stock (the primary);
   *  used somewhere → clear every platform. Open the image for per-platform
   *  stamps. The optimistic patch is reconciled with the DB response (the
   *  upscales inherit the stamp server-side). */
  async function toggleUsed(image: StockImage) {
    const anyNow = (image.used_count ?? 0) > 0 || Object.values(image.used ?? {}).some(Boolean);
    const usedNext = anyNow
      ? { adobe_stock: false, shutterstock: false, istock: false, wirestock: false, pond5: false, depositphotos: false, "123rf": false, dreamstime: false }
      : { ...(image.used ?? {}), adobe_stock: true };
    const patch = {
      used: usedNext,
      used_in_adobe_stock: usedNext.adobe_stock === true,
      used_count: Object.values(usedNext).filter(Boolean).length,
    };
    setDetail((d) => (d && d._id === image._id ? { ...d, ...patch } : d));
    list.patchLocal(image._id, patch);
    if (patch.used_count > 0) setThunk((t) => t + 1);
    try {
      const res = await api.images.update(image._id, { used: usedNext });
      // reconcile with the fresh DB doc (full row refresh)
      setDetail((d) => (d && d._id === res.data._id ? res.data : d));
      list.patchLocal(res.data._id, res.data);
    } catch {
      const rollback = { used: image.used, used_in_adobe_stock: image.used_in_adobe_stock, used_count: image.used_count };
      list.patchLocal(image._id, rollback);
      setDetail((d) => (d && d._id === image._id ? { ...d, ...rollback } : d));
      toast({ variant: "destructive", title: "Update failed", description: "The stamp was not applied." });
    }
  }

  /** Detail dialog reports mutations (fresh DB doc in the API responses,
   *  silent refresh on open) — refresh the detail state and the grid row
   *  in place with the WHOLE doc (never a stale subset). */
  function handleImageUpdate(updated: StockImage) {
    setDetail((d) => (d && d._id === updated._id ? updated : d));
    list.patchLocal(updated._id, updated);
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

  /** Open the platform picker — the CSV itself is built per platform
   *  (originals and/or upscaled variants — selection survives pagination). */
  function downloadCsv() {
    setCsvDialogOpen(true);
  }

  /** Fresh copy of the whole selection, re-read from the DB — the popup
   *  counts ([N to mark] / [N marked]) and the CSV rows are computed from
   *  the DB state, never from the grid snapshot. */
  function refreshBulkItems(): Promise<{ items: CsvSelectionItem[]; skipped: number }> {
    return fetchFreshSelectionItems(csvSel.list).then(({ items, skipped }) => {
      setBulkItems(items);
      return { items, skipped };
    });
  }

  // The platform-picker popup re-reads the selection from the DB every
  // time it opens (mark AND unmark) — fresh stats, no cached data.
  const csvListRef = useRef(csvSel.list);
  csvListRef.current = csvSel.list;
  useEffect(() => {
    if (bulkMode === null) {
      setBulkItems(null);
      return;
    }
    let alive = true;
    setBulkLoading(true);
    fetchFreshSelectionItems(csvListRef.current)
      .then(({ items }) => {
        if (!alive) return;
        setBulkItems(items);
      })
      .catch(() => {
        // the DB read failed — fall back to the selection snapshot
        if (alive) setBulkItems(csvListRef.current);
      })
      .finally(() => {
        if (alive) setBulkLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [bulkMode]);

  /** Bulk mark/unmark for the checkbox multi-selection — the SelectionBar's
   *  stamp buttons open the platform picker popup (BulkUsedDialog), then the
   *  confirm sends ONE request for the whole batch (mark mode → used:true on
   *  the chosen platforms; unmark mode → used:false). Already-marked targets
   *  are skipped and stay marked. Only the ORIGIN images are stamped: upscale
   *  variants follow their original image (the API propagates the Adobe
   *  Stock flag onto every variant). */
  async function bulkStampUsed(used: boolean, platforms?: PlatformId[]) {
    const image_ids = csvSel.list.filter((it) => !it.upscale).map((it) => it.image._id);
    if (image_ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await api.images.bulkUsed({ used, platforms, image_ids });
      for (const doc of res.data.images) {
        list.patchLocal(doc._id, doc); // full fresh doc — DB state, in place
      }
      setThunk((t) => t + 1);
      const platformNames = platforms?.map((p) => PLATFORMS.find((d) => d.id === p)?.label ?? p).join(", ");
      const skippedNote =
        res.data.missing.length > 0 ? ` ${res.data.missing.length} image(s) no longer exist and were skipped.` : "";
      toast({
        title: used ? "Marked as used" : "Unmarked as used",
        description: used
          ? `${res.data.changed} image${res.data.changed === 1 ? "" : "s"} stamped on ${platformNames}${
              res.data.changed < res.data.marked ? ` (${res.data.marked - res.data.changed} already marked, kept as used)` : ""
            } — upscales follow their original — the selection was cleared.${skippedNote}`
          : platforms
            ? `${res.data.changed} image${res.data.changed === 1 ? "" : "s"} unmarked from ${platformNames} — the selection was cleared.${skippedNote}`
            : `Every platform flag cleared on ${res.data.marked} image${res.data.marked === 1 ? "" : "s"} — the selection was cleared.`,
      });
      csvSel.clear();
      setBulkMode(null);
    } catch (e: unknown) {
      const msg = (e as { payload?: { message?: string } })?.payload?.message || "The bulk stamp was not applied.";
      toast({ variant: "destructive", title: "Bulk update failed", description: msg });
    } finally {
      setBulkBusy(false);
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

        {!list.loading && images.length > 0 && (
          <BulkSelectPanel
            images={images}
            page={list.params.page}
            onApply={(categories, mode) => csvSel.bulkApply(images, categories, mode)}
            onClearAll={csvSel.clear}
          />
        )}

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
          originCount={csvSel.list.filter((it) => !it.upscale).length}
          busy={bulkBusy}
          onMarkUsed={() => setBulkMode("mark")}
          onUnmarkUsed={() => setBulkMode("unmark")}
          onDownload={downloadCsv}
          onClear={csvSel.clear}
        />
      </main>

      <BulkUsedDialog
        open={bulkMode !== null}
        onOpenChange={(open) => !open && setBulkMode(null)}
        mode={bulkMode ?? "mark"}
        items={bulkItems ?? csvSel.list}
        loading={bulkLoading}
        busy={bulkBusy}
        onConfirm={(platforms) => bulkStampUsed(bulkMode === "mark", platforms)}
        onClearAll={() => bulkStampUsed(false)}
      />

      <CsvPlatformDialog
        open={csvDialogOpen}
        onOpenChange={setCsvDialogOpen}
        items={csvSel.list}
        fetchFresh={refreshBulkItems}
      />

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
