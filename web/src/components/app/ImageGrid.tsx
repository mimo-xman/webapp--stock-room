"use client";

import { ImageCard } from "./ImageCard";
import type { StockImage } from "@/lib/types";

interface ImageGridProps {
  images: StockImage[];
  loading?: boolean;
  onOpen: (image: StockImage) => void;
  onToggleUsed: (image: StockImage) => void;
  thunkKey?: number;
  /** CSV selection resolver — when provided, each card gets its checkbox
   *  (original variant). Undefined = feature not wired on that page. */
  selectionFor?: (image: StockImage) => { selected: boolean; onToggle: (image: StockImage) => void } | undefined;
}

export function ImageGrid({ images, loading, onOpen, onToggleUsed, thunkKey = 0, selectionFor }: ImageGridProps) {
  if (loading) {
    return (
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        aria-busy="true"
        aria-label="Loading images"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border border-line bg-surface">
            <div className="aspect-[4/3] animate-pulse bg-muted" />
            <div className="space-y-2 p-3">
              <div className="h-3.5 w-4/5 animate-pulse bg-muted" />
              <div className="h-3 w-2/5 animate-pulse bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" role="list">
      {images.map((image) => {
        const selection = selectionFor?.(image);
        return (
          <ImageCard
            key={image._id}
            image={image}
            onOpen={onOpen}
            onToggleUsed={onToggleUsed}
            thunkKey={thunkKey}
            selected={selection?.selected ?? false}
            onToggleSelect={selection?.onToggle}
          />
        );
      })}
    </div>
  );
}
