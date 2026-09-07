"use client";

import { useState } from "react";
import { AlertTriangle, Check, ImageOff, Layers, LoaderCircle, Power, Stamp, ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { StampToggle } from "./StampToggle";
import type { StockImage } from "@/lib/types";

interface ImageCardProps {
  image: StockImage;
  onOpen: (image: StockImage) => void;
  onToggleUsed: (image: StockImage) => void;
  thunkKey?: number;
  /** CSV export selection for the ORIGINAL variant (undefined = feature off). */
  selected?: boolean;
  onToggleSelect?: (image: StockImage) => void;
}

/** Used on at least one marketplace (any-platform view of the used flags). */
function anyUsed(image: StockImage): boolean {
  return (image.used_count ?? 0) > 0 || Object.values(image.used ?? {}).some(Boolean);
}

export function ImageCard({ image, onOpen, onToggleUsed, thunkKey = 0, selected = false, onToggleSelect }: ImageCardProps) {
  const [broken, setBroken] = useState(false);

  return (
    <article
      className={cn(
        "group flex cursor-pointer flex-col border border-line-strong bg-surface transition-shadow hover:border-ink hover:shadow-[var(--shadow-hard)] focus-visible:outline-2 focus-visible:outline-brand",
        selected && "border-brand"
      )}
      onClick={() => onOpen(image)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(image);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Open ${image.title || image.metadata?.adobe_stock?.title || "image"}`}
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
            alt={image.title || "stock image"}
            loading="lazy"
            onError={() => setBroken(true)}
            className={cn(
              "h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]",
              anyUsed(image) && "opacity-95",
              image.active === false && "opacity-70 saturate-50"
            )}
          />
        )}

        {/* batch-worker status: paused / failed / currently upscaling */}
        {(image.active === false || image.in_use === true) && (
          <span
            className={cn(
              "absolute bottom-2 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider shadow-[var(--shadow-hard-sm)]",
              image.in_use
                ? "bg-brand text-white"
                : "bg-danger-soft text-danger"
            )}
            data-testid="image-status-chip"
          >
            {image.in_use ? (
              <>
                <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
                upscaling
              </>
            ) : (
              <>
                <Power className="h-3 w-3" aria-hidden />
                inactive
              </>
            )}
          </span>
        )}

        {anyUsed(image) && (
          <span key={thunkKey} className="stamp stamp-thunk pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] sm:text-xs">
            Used · published
          </span>
        )}

        <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
          <StampToggle used={anyUsed(image)} onToggle={() => onToggleUsed(image)} />
        </div>

        {onToggleSelect && (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={`Select ${image.title || "image"} for the CSV export`}
            title="Select for the CSV export"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(image);
            }}
            className={cn(
              "absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center border transition-colors focus-visible:outline-2 focus-visible:outline-brand",
              selected
                ? "border-brand bg-brand text-white"
                : "border-line-strong bg-surface/90 text-transparent hover:border-ink",
              !selected && "opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100"
            )}
            data-testid="select-original"
          >
            <Check className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug">{image.title || image.metadata?.adobe_stock?.title || "Untitled"}</h3>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          {image.category ? (
            <span className="chip max-w-full truncate border-line-strong text-ink">{image.category}</span>
          ) : null}
          <span className="chip">{image.quality}</span>
          <span className="chip">{image.ratio}</span>
          <span
            className="chip border-brand/60 text-brand"
            title={`${Object.values(image.used ?? {}).filter(Boolean).length} platform(s) marked used — open the image for per-platform details`}
          >
            <Layers className="mr-0.5 h-3 w-3" aria-hidden />
            {Object.values(image.used ?? {}).filter(Boolean).length || (image.metadata ? Object.keys(image.metadata).length : 0)}
          </span>
          {(image.upscales?.length ?? 0) > 0 && (
            <span
              className="chip border-brand/60 text-brand"
              title={`${image.upscales!.length} upscaled variant(s) — open the image to view them`}
            >
              <ZoomIn className="mr-0.5 h-3 w-3" aria-hidden />
              ×{image.upscales!.length}
            </span>
          )}
          {image.error_message && (
            <span
              className="chip border-danger/60 text-danger"
              title={image.error_message}
              data-testid="image-error-chip"
            >
              <AlertTriangle className="mr-0.5 h-3 w-3" aria-hidden />
              error
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-ink-muted">
            <Stamp className="h-3 w-3" aria-hidden />
            {(image.metadata?.adobe_stock?.keywords ?? image.keywords ?? []).length}
          </span>
        </div>
      </div>
    </article>
  );
}
