"use client";

/**
 * Session detail — the batch's images (contact sheet) + session actions.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Images } from "lucide-react";
import { TopBar } from "@/components/app/TopBar";
import { FilterBar } from "@/components/app/FilterBar";
import { PaginationBar } from "@/components/app/PaginationBar";
import { ImageGrid } from "@/components/app/ImageGrid";
import { ImageDetailDialog } from "@/components/app/ImageDetailDialog";
import { ImageFormDialog } from "@/components/app/ImageFormDialog";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { EmptyState } from "@/components/app/EmptyState";
import { useList, useSessionOptions } from "@/hooks/use-list";
import { useCsvSelection } from "@/hooks/use-csv-selection";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { IMAGE_SORTS } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import { SelectionBar } from "@/components/app/SelectionBar";
import { CsvPlatformDialog } from "@/components/app/CsvPlatformDialog";
import type { Session, StockImage } from "@/lib/types";

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const list = useList((p) => api.images.list({ ...p, filters: { ...p.filters, session_id: id } }), {
    filters: { session_id: id },
  });
  const sessionOptions = useSessionOptions();
  const csvSel = useCsvSelection();
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);

  const [detail, setDetail] = useState<StockImage | null>(null);
  const [editing, setEditing] = useState<StockImage | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmDeleteSession, setConfirmDeleteSession] = useState(false);
  const [thunk, setThunk] = useState(0);

  useEffect(() => {
    let alive = true;
    api.sessions
      .get(id)
      .then((r) => alive && setSession(r.data))
      .catch((e) => {
        if (!alive) return;
        setSessionError(e instanceof ApiError ? e.payload?.message || "Session not found" : "Could not reach the API");
      });
    return () => {
      alive = false;
    };
  }, [id, list.nonce]);

  const images = list.items as StockImage[];

  function openDetail(image: StockImage) {
    // refresh the row's data in the dialog from the list state
    setDetail(images.find((i) => i._id === image._id) || image);
  }

  /** Quick stamp: not used anywhere → mark Adobe Stock (the primary);
   *  used somewhere → clear every platform. Open the image for per-platform
   *  stamps. */
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
    if (detail?._id === image._id) setDetail({ ...detail, ...patch });
    list.patchLocal(image._id, patch);
    if (patch.used_count > 0) setThunk((t) => t + 1);
    try {
      await api.images.update(image._id, { used: usedNext });
    } catch {
      const rollback = { used: image.used, used_in_adobe_stock: image.used_in_adobe_stock, used_count: image.used_count };
      list.patchLocal(image._id, rollback);
      if (detail?._id === image._id) setDetail({ ...detail, ...rollback });
      toast({ variant: "destructive", title: "Update failed", description: "The stamp was not applied." });
    }
  }

  /** Detail dialog reports upscale mutations (mark used / delete) and
   *  batch-status changes (pause / error dismissed) with the updated image —
   *  refresh the detail state and the grid row in place. */
  function handleImageUpdate(updated: StockImage) {
    setDetail((d) => (d && d._id === updated._id ? updated : d));
    list.patchLocal(updated._id, {
      upscales: updated.upscales,
      active: updated.active,
      in_use: updated.in_use,
      in_use_at: updated.in_use_at,
      error_message: updated.error_message,
    });
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

  async function deleteSession() {
    try {
      const res = await api.sessions.remove(id);
      toast({
        title: "Session deleted",
        description: `${res.data.imagesDeleted} image${res.data.imagesDeleted === 1 ? "" : "s"} and ${res.data.productsDeleted ?? 0} Etsy product${(res.data.productsDeleted ?? 0) === 1 ? "" : "s"} removed with it.`,
      });
      router.push("/sessions");
    } catch {
      toast({ variant: "destructive", title: "Delete failed", description: "Try again in a moment." });
      setConfirmDeleteSession(false);
    }
  }

  if (sessionError) {
    return (
      <>
        <TopBar />
        <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
          <Link href="/sessions" className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-ink-muted hover:text-brand">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Sessions
          </Link>
          <p className="border border-danger bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{sessionError}</p>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        <Link
          href="/sessions"
          className="flex w-fit items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-ink-muted hover:text-brand"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Sessions
        </Link>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words font-display text-3xl font-bold uppercase leading-tight tracking-tight">
              {session ? session.title : "…"}
            </h1>
            <p className="mt-1 font-mono text-xs text-ink-muted">
              {session
                ? `created ${formatDateTime(session.createdAt)} · ${session.imagesCount} images · ${session.usedCount ?? 0} used${session.productsCount ? ` · ${session.productsCount} Etsy product${session.productsCount === 1 ? "" : "s"}` : ""}`
                : "…"}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
            <button
              type="button"
              onClick={() => setConfirmDeleteSession(true)}
              className="flex h-10 items-center gap-2 border border-danger/40 bg-surface px-4 font-display text-sm font-semibold uppercase tracking-widest text-danger transition-colors hover:border-danger hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-brand"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete session
            </button>
          </div>
        </div>

        <FilterBar
          params={list.params}
          onChange={list.updateParams}
          onFilter={list.updateFilter}
          onReset={list.reset}
          searchPlaceholder="Search this session…"
          sortOptions={IMAGE_SORTS}
          hideSearch={false}
        />

        {list.error && (
          <p className="border border-danger bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{list.error}</p>
        )}

        {list.loading ? (
          <ImageGrid images={[]} loading onOpen={openDetail} onToggleUsed={toggleUsed} />
        ) : images.length === 0 ? (
          <EmptyState
            icon={<Images className="h-6 w-6" aria-hidden />}
            title={list.params.search ? "No image matches" : "No images in this session"}
            hint={
              list.params.search
                ? "Try another search."
                : "Agent runs register generated images here. You can also add one manually."
            }
            action={
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                className="flex h-10 items-center gap-2 bg-brand px-4 font-display text-sm font-bold uppercase tracking-widest text-white transition-colors hover:bg-brand-deep"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Add the first image
              </button>
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
          onDownload={downloadCsv}
          onClear={csvSel.clear}
        />
      </main>

      <CsvPlatformDialog
        open={csvDialogOpen}
        onOpenChange={setCsvDialogOpen}
        items={csvSel.list}
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
        sessionTitle={session?.title}
      />

      <ImageFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        image={editing}
        fixedSessionId={id}
        sessionOptions={sessionOptions}
        onSaved={() => {
          list.reload();
          api.sessions.get(id).then((r) => setSession(r.data)).catch(() => {});
        }}
      />

      <ConfirmDialog
        open={confirmDeleteSession}
        onOpenChange={setConfirmDeleteSession}
        title="Delete this session?"
        description={`"${session?.title}" and its ${session?.imagesCount ?? 0} image${(session?.imagesCount ?? 0) === 1 ? "" : "s"}${session?.productsCount ? ` + ${session.productsCount} Etsy product${session.productsCount === 1 ? "" : "s"}` : ""} will be permanently deleted.`}
        confirmLabel="Delete session"
        danger
        onConfirm={deleteSession}
      />
    </>
  );
}
