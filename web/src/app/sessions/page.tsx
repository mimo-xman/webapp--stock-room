"use client";

/**
 * Sessions page — the production ledger.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Boxes, ChevronRight } from "lucide-react";
import { TopBar } from "@/components/app/TopBar";
import { FilterBar } from "@/components/app/FilterBar";
import { PaginationBar } from "@/components/app/PaginationBar";
import { SessionFormDialog } from "@/components/app/SessionFormDialog";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { EmptyState } from "@/components/app/EmptyState";
import { useList } from "@/hooks/use-list";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { SESSION_SORTS } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import type { Session } from "@/lib/types";

export default function SessionsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const list = useList((p) => api.sessions.list(p));
  const [createOpen, setCreateOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Session | null>(null);

  async function confirmDelete() {
    if (!toDelete) return;
    try {
      const res = await api.sessions.remove(toDelete._id);
      toast({
        title: "Session deleted",
        description: `${res.data.imagesDeleted} image${res.data.imagesDeleted === 1 ? "" : "s"}${res.data.productsDeleted ? ` and ${res.data.productsDeleted} Etsy product${res.data.productsDeleted === 1 ? "" : "s"}` : ""} removed with it.`,
      });
      setToDelete(null);
      list.reload();
    } catch {
      toast({ variant: "destructive", title: "Delete failed", description: "Try again in a moment." });
      setToDelete(null);
    }
  }

  const rows = useMemo(() => list.items as Session[], [list.items]);

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold uppercase tracking-tight">Sessions</h1>
            <p className="font-mono text-xs text-ink-muted">
              {list.pagination
                ? `${list.pagination.total} session${list.pagination.total === 1 ? "" : "s"} · ${rows.reduce((a, s) => a + s.imagesCount, 0)} images · ${rows.reduce((a, s) => a + (s.productsCount ?? 0), 0)} Etsy products`
                : "…"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex h-10 items-center gap-2 bg-brand px-4 font-display text-sm font-bold uppercase tracking-widest text-white shadow-[var(--shadow-hard-sm)] transition-colors hover:bg-brand-deep focus-visible:outline-2 focus-visible:outline-brand"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New session
          </button>
        </div>

        <FilterBar
          params={list.params}
          onChange={list.updateParams}
          onFilter={list.updateFilter}
          onReset={list.reset}
          searchPlaceholder="Search titles…"
          sortOptions={SESSION_SORTS}
        />

        {list.error && (
          <p className="border border-danger bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
            {list.error}
          </p>
        )}

        {list.loading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading sessions">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse border border-line bg-surface" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Boxes className="h-6 w-6" aria-hidden />}
            title={list.params.search ? "No session matches" : "No sessions yet"}
            hint={
              list.params.search
                ? "Try another search — titles are matched exactly as typed."
                : "Sessions are created by agent runs, or manually here. A session groups one production batch."
            }
            action={
              !list.params.search && (
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="flex h-10 items-center gap-2 bg-brand px-4 font-display text-sm font-bold uppercase tracking-widest text-white transition-colors hover:bg-brand-deep"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Create the first session
                </button>
              )
            }
          />
        ) : (
          <ul className="border border-line-strong bg-surface" role="list">
            {rows.map((s) => (
              <li
                key={s._id}
                role="listitem"
                className="group grid cursor-pointer grid-cols-[1fr_auto] items-center gap-3 border-b border-line px-4 py-3 transition-colors last:border-b-0 hover:bg-paper focus-within:bg-paper"
                onClick={() => router.push(`/sessions/${s._id}`)}
              >
                <div className="min-w-0">
                  <p className="truncate font-display text-base font-semibold uppercase tracking-wide group-focus-within:underline">
                    {s.title}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                    created {formatDateTime(s.createdAt)} · updated {formatDateTime(s.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="flex items-center gap-1.5 border border-line-strong px-2 py-1 font-mono text-[11px] text-ink"
                    title={`${s.imagesCount} sellable image(s) · ${s.productsCount ?? 0} Etsy product(s) · ${s.usedCount ?? 0} marked as used`}
                  >
                    {s.imagesCount} img
                    <span className="text-brand">
                      · {s.productsCount ?? 0} Etsy product{(s.productsCount ?? 0) === 1 ? "" : "s"}
                    </span>
                    <span className="text-stamp">· {s.usedCount ?? 0} used</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setToDelete(s);
                    }}
                    className="flex h-8 w-8 items-center justify-center border border-line-strong bg-surface text-ink-muted opacity-0 transition-all group-hover:opacity-100 hover:border-danger hover:text-danger max-md:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-brand"
                    aria-label={`Delete session ${s.title}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <PaginationBar pagination={list.pagination} onChange={list.updateParams} />
      </main>

      <SessionFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={list.reload} />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this session?"
        description={
          toDelete
            ? `"${toDelete.title}" and its ${toDelete.imagesCount} image${toDelete.imagesCount === 1 ? "" : "s"}${toDelete.productsCount ? ` + ${toDelete.productsCount} Etsy product${toDelete.productsCount === 1 ? "" : "s"}` : ""} will be permanently deleted.`
            : ""
        }
        confirmLabel="Delete session"
        danger
        onConfirm={confirmDelete}
      />
    </>
  );
}
