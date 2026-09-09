"use client";

/**
 * Selection state for the CSV export (Adobe Stock contributor format —
 * see docs/CSV_EXPORT.md) AND the bulk "Mark as used" stamp: the same
 * checkbox selection feeds both actions of the sticky SelectionBar.
 *
 * The Map lives in the PAGE component (mounted once per route), so the
 * selection SURVIVES pagination, filtering and sorting — all of those only
 * refetch the list, they never unmount the page. Each entry snapshots the
 * image doc (and the chosen upscale variant) at selection time: the CSV can
 * still be built even if the list has since moved to another page, and the
 * bulk stamp carries the exact variant ids.
 *
 * bulkApply() powers the Select all / Deselect all bar: it applies one set
 * of categories (original / ×2 / ×4 upscales) to a whole PAGE of images at
 * once — accumulate page 1, move to page 2, apply again, and the selection
 * keeps growing.
 */

import { useCallback, useMemo, useState } from "react";
import type { CsvSelectionItem } from "@/lib/csv";
import type { StockImage, Upscale } from "@/lib/types";

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
