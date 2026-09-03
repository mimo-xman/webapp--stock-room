"use client";

/**
 * Requisition bar — search, filters, sort + ASC/DESC switch, date range.
 * One generic component serves the Sessions and Images pages.
 */

import { useRef, useState } from "react";
import { Search, RotateCcw, ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ListParams } from "@/lib/types";

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

interface FilterBarProps {
  params: ListParams;
  onChange: (patch: Partial<ListParams>) => void;
  onFilter: (key: string, value: string) => void;
  onReset: () => void;
  searchPlaceholder: string;
  filters?: FilterDef[];
  sortOptions: readonly { value: string; label: string }[];
  showDates?: boolean;
  hideSearch?: boolean;
}

export function FilterBar({
  params,
  onChange,
  onFilter,
  onReset,
  searchPlaceholder,
  filters = [],
  sortOptions,
  showDates = true,
  hideSearch = false,
}: FilterBarProps) {
  // local search box commits after a short debounce or on Enter
  const [text, setText] = useState(params.search);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync the local box when the parent resets params (adjust-state-during-render pattern).
  const [prevSearch, setPrevSearch] = useState(params.search);
  if (prevSearch !== params.search) {
    setPrevSearch(params.search);
    setText(params.search);
  }

  function commitSearch(value: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange({ search: value }), 350);
  }

  const activeCount =
    (params.search ? 1 : 0) +
    Object.values(params.filters).filter(Boolean).length +
    (params.from ? 1 : 0) +
    (params.to ? 1 : 0);

  const asc = params.order === "asc";

  return (
    <section
      aria-label="Search, filters and sorting"
      className="border border-ink bg-surface shadow-[var(--shadow-hard-sm)]"
    >
      <div className="flex flex-wrap items-end gap-2.5 p-3">
        {!hideSearch && (
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <span className="eyebrow absolute -top-3 left-0 bg-surface px-1">Search</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            <Input
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                commitSearch(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (timer.current) clearTimeout(timer.current);
                  onChange({ search: text });
                }
              }}
              placeholder={searchPlaceholder}
              className="h-9 rounded-none border-line-strong pl-8 font-mono text-[13px]"
              aria-label={searchPlaceholder}
            />
          </div>
        )}

        {filters.map((f) => (
          <div key={f.key} className="relative w-[150px]">
            <span className="eyebrow absolute -top-3 left-0 bg-surface px-1">{f.label}</span>
            <Select
              value={params.filters[f.key] || "all"}
              onValueChange={(v) => onFilter(f.key, v === "all" ? "" : v)}
            >
              <SelectTrigger
                className="h-9 w-full rounded-none border-line-strong font-mono text-[13px]"
                aria-label={`Filter by ${f.label.toLowerCase()}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none border-ink font-mono text-[13px]">
                <SelectItem value="all">All</SelectItem>
                {f.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}

        {showDates && (
          <div className="relative w-[140px]">
            <span className="eyebrow absolute -top-3 left-0 bg-surface px-1">From</span>
            <Input
              type="date"
              value={params.from}
              onChange={(e) => onChange({ from: e.target.value })}
              className="h-9 rounded-none border-line-strong px-2 font-mono text-[12px]"
              aria-label="Created from date"
            />
          </div>
        )}
        {showDates && (
          <div className="relative w-[140px]">
            <span className="eyebrow absolute -top-3 left-0 bg-surface px-1">To</span>
            <Input
              type="date"
              value={params.to}
              onChange={(e) => onChange({ to: e.target.value })}
              className="h-9 rounded-none border-line-strong px-2 font-mono text-[12px]"
              aria-label="Created to date"
            />
          </div>
        )}

        <div className="relative ml-auto w-[140px]">
          <span className="eyebrow absolute -top-3 left-0 bg-surface px-1">Sort</span>
          <Select value={params.sort} onValueChange={(v) => onChange({ sort: v })}>
            <SelectTrigger
              className="h-9 w-full rounded-none border-line-strong font-mono text-[13px]"
              aria-label="Sort field"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none border-ink font-mono text-[13px]">
              {sortOptions.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <button
          type="button"
          onClick={() => onChange({ order: asc ? "desc" : "asc" })}
          className={cn(
            "flex h-9 w-9 items-center justify-center border transition-colors focus-visible:outline-2 focus-visible:outline-brand",
            asc
              ? "border-line-strong bg-surface text-ink-muted hover:border-ink hover:text-ink"
              : "border-ink bg-ink text-paper"
          )}
          aria-label={`Switch sort direction (currently ${asc ? "ascending" : "descending"})`}
          title={`Sort ${asc ? "ascending" : "descending"} — click to switch`}
        >
          {asc ? (
            <ArrowUpNarrowWide className="h-4 w-4" aria-hidden />
          ) : (
            <ArrowDownWideNarrow className="h-4 w-4" aria-hidden />
          )}
        </button>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="flex h-9 items-center gap-1.5 border border-line-strong bg-surface px-3 font-display text-xs font-semibold uppercase tracking-wide text-ink-muted transition-colors hover:border-danger hover:text-danger focus-visible:outline-2 focus-visible:outline-brand"
            aria-label="Clear all filters"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Clear ({activeCount})
          </button>
        )}
      </div>
    </section>
  );
}
