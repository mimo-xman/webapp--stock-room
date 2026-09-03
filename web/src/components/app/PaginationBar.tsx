"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PAGE_SIZES } from "@/lib/constants";
import type { Pagination } from "@/lib/types";

interface PaginationBarProps {
  pagination: Pagination | null;
  onChange: (patch: { page?: number; limit?: number }) => void;
}

export function PaginationBar({ pagination, onChange }: PaginationBarProps) {
  if (!pagination) return null;
  const { page, limit, total, totalPages } = pagination;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center gap-3 border border-line-strong bg-surface px-3 py-2"
    >
      <span className="font-mono text-xs text-ink-muted" aria-live="polite">
        {from}–{to} of {total}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <span className="eyebrow hidden sm:block">Per page</span>
        <Select
          value={String(limit)}
          onValueChange={(v) => onChange({ limit: Number(v), page: 1 })}
        >
          <SelectTrigger className="h-8 w-[70px] rounded-none border-line-strong font-mono text-xs" aria-label="Items per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-none border-ink font-mono text-xs">
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange({ page: page - 1 })}
          className="flex h-8 w-8 items-center justify-center border border-line-strong bg-surface transition-colors enabled:hover:border-ink disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-brand"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <span className="font-mono text-xs" aria-current="page">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange({ page: page + 1 })}
          className="flex h-8 w-8 items-center justify-center border border-line-strong bg-surface transition-colors enabled:hover:border-ink disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-brand"
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </nav>
  );
}
