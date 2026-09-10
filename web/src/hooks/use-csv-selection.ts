"use client";

/**
 * Selection state for the CSV export (Adobe Stock contributor format —
 * see docs/CSV_EXPORT.md) AND the bulk "Mark as used" stamp: the same
 * checkbox selection feeds both actions of the sticky SelectionBar.
 *
 * The Map lives in the PAGE component (mounted once per route), so the
 * selection SURVIVES pagination, filtering and sorting — all of those only
 * refetch the list, they never unmount the page. Each entry snapshots the
 * image doc (and the chosen upscale variant) at selection time — the SNAPSHOT
 * IS the selection (stable ids), but nothing ever READS from it: before any
 * action (platform-picker stats, CSV build, bulk stamp) the page re-reads
 * every selected image from the DB via fetchFreshSelectionItems().
 *
 * bulkApply() powers the Select all / Deselect all bar: it applies one set
 * of categories (original / ×2 / ×4 upscales) to a whole PAGE of images at
 * once — accumulate page 1, move to page 2, apply again, and the selection
 * keeps growing.
 */

import { useCallback, useMemo, useState } from "react";
import type { CsvSelectionItem } from "@/lib/csv";
import type { StockImage, Upscale } from "@/lib/types";
import { api } from "@/lib/api";

/** Variant id for the original image inside the selection keys. */
export const ORIGINAL_VARIANT = "original";

/** Selectable asset categories of one image (original + upscale scales). */
export type SelectionCategory = "origin" | "x2" | "x4";

export function variantKey(imageId: string, variantId: string): string {
  return `${imageId}:${variantId}`;
}

export function useCsvSelection() {
  const [entries, setEntries] = useState<Map<string, CsvSelectionItem>>(new Map());

  const isSelected = useCallback(
    (imageId: string, variantId: string = ORIGINAL_VARIANT) =>
      entries.has(variantKey(imageId, variantId)),
    [entries],
  );

  /** Toggle the original image (no upscale) or a specific upscale variant. */
  const toggle = useCallback((image: StockImage, upscale?: Upscale) => {
    const variantId = upscale?._id ?? ORIGINAL_VARIANT;
    const key = variantKey(image._id, variantId);
    setEntries((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, { image, upscale });
      return next;
    });
  }, []);

  const clear = useCallback(() => setEntries(new Map()), []);

  /** Select / deselect every entry of the given categories for a PAGE of
   *  images (original + every upscale matching the checked scales). */
  const bulkApply = useCallback(
    (images: StockImage[], categories: SelectionCategory[], mode: "add" | "remove") => {
      if (categories.length === 0 || images.length === 0) return;
      setEntries((prev) => {
        const next = new Map(prev);
        for (const image of images) {
          const targets: Array<[string, CsvSelectionItem]> = [];
          if (categories.includes("origin")) {
            targets.push([variantKey(image._id, ORIGINAL_VARIANT), { image }]);
          }
          for (const upscale of image.upscales ?? []) {
            if (upscale.scale === 2 && categories.includes("x2")) {
              targets.push([variantKey(image._id, upscale._id), { image, upscale }]);
            }
            if (upscale.scale === 4 && categories.includes("x4")) {
              targets.push([variantKey(image._id, upscale._id), { image, upscale }]);
            }
          }
          for (const [key, item] of targets) {
            if (mode === "add") next.set(key, item);
            else next.delete(key);
          }
        }
        return next;
      });
    },
    [],
  );

  const list = useMemo(() => [...entries.values()], [entries]);

  return { entries, list, count: entries.size, isSelected, toggle, clear, bulkApply };
}

export type CsvSelection = ReturnType<typeof useCsvSelection>;

/**
 * Re-read the whole checkbox selection FROM THE DB right before acting on
 * it (mark/unmark popup stats, CSV export): never trust the grid snapshot
 * for reads — an image or variant may have been stamped, edited or deleted
 * since it was selected. Deleted images / deleted variants are dropped and
 * counted in `skipped` so the caller can warn about them.
 */
export async function fetchFreshSelectionItems(
  items: CsvSelectionItem[],
): Promise<{ items: CsvSelectionItem[]; skipped: number; missingImages: string[] }> {
  const ids = [...new Set(items.map((it) => it.image._id))];
  if (ids.length === 0) return { items: [], skipped: 0, missingImages: [] };
  const res = await api.images.bulkFetch(ids);
  const byId = new Map(res.images.map((d) => [d._id, d]));
  const fresh: CsvSelectionItem[] = [];
  let skipped = 0;
  for (const it of items) {
    const doc = byId.get(it.image._id);
    if (!doc) {
      skipped += 1; // the whole image is gone
      continue;
    }
    if (it.upscale) {
      const freshUpscale = doc.upscales?.find((u) => u._id === it.upscale!._id);
      if (!freshUpscale) {
        skipped += 1; // that variant was deleted since selection
        continue;
      }
      fresh.push({ image: doc, upscale: freshUpscale });
    } else {
      fresh.push({ image: doc });
    }
  }
  return { items: fresh, skipped, missingImages: res.missing.map((m) => m.image_id) };
}
