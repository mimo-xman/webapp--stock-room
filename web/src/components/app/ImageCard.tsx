"use client";

import { useState } from "react";
import { ImageOff, Stamp, ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { StampToggle } from "./StampToggle";
import type { StockImage } from "@/lib/types";

interface ImageCardProps {
  image: StockImage;
  onOpen: (image: StockImage) => void;
  onToggleUsed: (image: StockImage) => void;
  thunkKey?: number;
}

export function ImageCard({ image, onOpen, onToggleUsed, thunkKey = 0 }: ImageCardProps) {
  const [broken, setBroken] = useState(false);

  return (
    <article
      className="group flex cursor-pointer flex-col border border-line-strong bg-surface transition-shadow hover:border-ink hover:shadow-[var(--shadow-hard)] focus-visible:outline-2 focus-visible:outline-brand"
      onClick={() => onOpen(image)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(image);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Open ${image.title}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        {broken ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-ink-muted">
            <ImageOff className="h-6 w-6" aria-hidden />
            <span className="font-mono text-[10px] uppercase tracking-wider">preview unavailable</span>
          </div>
        ) : (
          <img
            src={image.image_link}
            alt={image.title}
            loading="lazy"
            onError={() => setBroken(true)}
            className={cn(
              "h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]",
              image.used_in_adobe_stock && "opacity-95"
            )}
          />
        )}

        {image.used_in_adobe_stock && (
          <span key={thunkKey} className="stamp stamp-thunk pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] sm:text-xs">
            Used · Adobe Stock
          </span>
        )}

        <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
          <StampToggle used={image.used_in_adobe_stock} onToggle={() => onToggleUsed(image)} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug">{image.title}</h3>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          <span className="chip max-w-full truncate border-line-strong text-ink">{image.category}</span>
          <span className="chip">{image.quality}</span>
          <span className="chip">{image.ratio}</span>
          {(image.upscales?.length ?? 0) > 0 && (
            <span
              className="chip border-brand/60 text-brand"
              title={`${image.upscales!.length} upscaled variant(s) — open the image to view them`}
            >
              <ZoomIn className="mr-0.5 h-3 w-3" aria-hidden />
              ×{image.upscales!.length}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-ink-muted">
            <Stamp className="h-3 w-3" aria-hidden />
            {image.keywords.length}
          </span>
        </div>
      </div>
    </article>
  );
}
