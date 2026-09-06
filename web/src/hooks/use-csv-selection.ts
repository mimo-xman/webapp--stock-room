"use client";

/**
 * Selection state for the CSV export (Adobe Stock contributor format —
 * see docs/CSV_EXPORT.md).
 *
 * The Map lives in the PAGE component (mounted once per route), so the
 * selection SURVIVES pagination, filtering and sorting — all of those only
 * refetch the list, they never unmount the page. Each entry snapshots the
 * image doc (and the chosen upscale variant) at selection time: the CSV can
 * still be built even if the list has since moved to another page.
 */

import { useCallback, useMemo, useState } from "react";
import type { CsvSelectionItem } from "@/lib/csv";
import type { StockImage, Upscale } from "@/lib/types";

/** Variant id for the original image inside the selection keys. */
export const ORIGINAL_VARIANT = "original";

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

  const list = useMemo(() => [...entries.values()], [entries]);

  return { entries, list, count: entries.size, isSelected, toggle, clear };
}

export type CsvSelection = ReturnType<typeof useCsvSelection>;
