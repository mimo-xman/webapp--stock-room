"use client";

/**
 * Session detail — everything a production batch holds:
 *
 *   · sellable IMAGES (images_to_bay) — contact sheet, CSV selection;
 *   · ETSY PRODUCTS (etsy_products) — their own grid + their own detail
 *     dialog (the owner's spec: a session can hold BOTH kinds).
 *
 * Add buttons: one per kind ("Add image" / "Add Etsy product") — each opens
 * the form specific to what it creates. Product cards open the Etsy detail
 * popup, image cards open the image detail popup.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Images, Store } from "lucide-react";
import { TopBar } from "@/components/app/TopBar";
import { FilterBar } from "@/components/app/FilterBar";
import { PaginationBar } from "@/components/app/PaginationBar";
import { ImageGrid } from "@/components/app/ImageGrid";
import { ImageDetailDialog } from "@/components/app/ImageDetailDialog";
import { ImageFormDialog } from "@/components/app/ImageFormDialog";
import { EtsyProductDetailDialog } from "@/components/app/EtsyProductDetailDialog";
import { EtsyProductFormDialog } from "@/components/app/EtsyProductFormDialog";
import { EtsyProductGrid } from "@/components/app/EtsyProductGrid";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { EmptyState } from "@/components/app/EmptyState";
import { useList, useSessionOptions } from "@/hooks/use-list";
import { useCsvSelection } from "@/hooks/use-csv-selection";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { IMAGE_SORTS, PLATFORMS } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import { SelectionBar } from "@/components/app/SelectionBar";
import { BulkSelectPanel } from "@/components/app/BulkSelectPanel";
import { BulkUsedDialog } from "@/components/app/BulkUsedDialog";
import { EtsyZipDialog } from "@/components/app/EtsyZipDialog";
import { CsvPlatformDialog } from "@/components/app/CsvPlatformDialog";
import type { Session, StockImage, EtsyProduct, PlatformId } from "@/lib/types";

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // ── sellable images of this session ──
  const list = useList((p) => api.images.list({ ...p, filters: { ...p.filters, session_id: id } }), {
    filters: { session_id: id },
  });
  const sessionOptions = useSessionOptions();
  const csvSel = useCsvSelection();
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);

  // ── Etsy products of this session ──
  const productList = useList((p) => api.etsyProducts.list({ ...p, filters: { ...p.filters, session_id: id } }), {
    filters: { session_id: id },
    limit: 20,
  });

  const [detail, setDetail] = useState<StockImage | null>(null);
  const [editing, setEditing] = useState<StockImage | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [productDetail, setProductDetail] = useState<EtsyProduct | null>(null);
  const [editingProduct, setEditingProduct] = useState<EtsyProduct | null>(null);
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [confirmDeleteSession, setConfirmDeleteSession] = useState(false);
  const [thunk, setThunk] = useState(0);
  const [bulkBusy, setBulkBusy] = useState(false);
  /** Platform picker popup (opened by the SelectionBar's stamp buttons). */
  const [bulkMode, setBulkMode] = useState<"mark" | "unmark" | null>(null);
  const [zipProduct, setZipProduct] = useState<EtsyProduct | null>(null);
  const [zipDialogOpen, setZipDialogOpen] = useState(false);

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
  }, [id, list.nonce, productList.nonce]);

  const images = list.items as StockImage[];
  const products = productList.items as EtsyProduct[];

  function openDetail(image: StockImage) {
    // refresh the row's data in the dialog from the list state
    setDetail(images.find((i) => i._id === image._id) || image);
  }

  function openProductDetail(product: EtsyProduct) {
    setProductDetail(products.find((p) => p._id === product._id) || product);
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

  function handleProductUpdate(updated: EtsyProduct) {
    setProductDetail((d) => (d && d._id === updated._id ? updated : d));
    setEditingProduct((e) => (e && e._id === updated._id ? updated : e));
    productList.patchLocal(updated._id, {
      used_in_etsy: updated.used_in_etsy,
      metadata: updated.metadata,
      images: updated.images,
    });
  }

  async function deleteImage(image: StockImage) {
    try {
      await api.images.remove(image._id);
      setDetail(null);
      toast({ title: "Image deleted", description: image.title });
      list.reload();
      api.sessions.get(id).then((r) => setSession(r.data)).catch(() => {});
    } catch {
      toast({ variant: "destructive", title: "Delete failed", description: "Try again in a moment." });
    }
  }

  async function deleteProduct(product: EtsyProduct) {
    try {
      await api.etsyProducts.remove(product._id);
      setProductDetail(null);
      toast({ title: "Product deleted", description: product.metadata.title });
      productList.reload();
      api.sessions.get(id).then((r) => setSession(r.data)).catch(() => {});
    } catch {
      toast({ variant: "destructive", title: "Delete failed", description: "Try again in a moment." });
    }
  }

  /** Open the platform picker — the CSV itself is built per platform
   *  (originals and/or upscaled variants — selection survives pagination). */
  function downloadCsv() {
    setCsvDialogOpen(true);
  }

  /** Bulk mark/unmark for the checkbox multi-selection — the SelectionBar's
   *  stamp buttons open the platform picker popup (BulkUsedDialog), then the
   *  confirm sends ONE request for the whole batch. Only the ORIGIN images
   *  are stamped: upscale variants follow their original image (the API
   *  propagates the Adobe Stock flag onto every variant). */
  async function bulkStampUsed(used: boolean, platforms?: PlatformId[]) {
    const image_ids = csvSel.list.filter((it) => !it.upscale).map((it) => it.image._id);
    if (image_ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await api.images.bulkUsed({ used, platforms, image_ids });
      for (const doc of res.data.images) {
        list.patchLocal(doc._id, {
          used: doc.used,
          used_count: doc.used_count,
          used_in_adobe_stock: doc.used_in_adobe_stock,
          upscales: doc.upscales,
        });
      }
      setThunk((t) => t + 1);
      refreshSessionHeader(); // the header shows the session's usedCount
      const platformNames = platforms?.map((p) => PLATFORMS.find((d) => d.id === p)?.label ?? p).join(", ");
      toast({
        title: used ? "Marked as used" : "Unmarked as used",
        description: used
          ? `${res.data.marked} image${res.data.marked === 1 ? "" : "s"} stamped on ${platformNames} — upscales follow their original — the selection was cleared.${
              res.data.missing.length > 0 ? ` ${res.data.missing.length} image(s) no longer exist and were skipped.` : ""
            }`
          : platforms
            ? `${res.data.marked} image${res.data.marked === 1 ? "" : "s"} unmarked from ${platformNames} — the selection was cleared.${
                res.data.missing.length > 0 ? ` ${res.data.missing.length} image(s) no longer exist and were skipped.` : ""
              }`
            : `Every platform flag cleared on ${res.data.marked} image${res.data.marked === 1 ? "" : "s"} — the selection was cleared.`,
      });
      csvSel.clear();
      setBulkMode(null);
    } catch (e: unknown) {
      const msg = (e as { payload?: { message?: string } })?.payload?.message || "The bulk stamp was not applied.";
      toast({ variant: "destructive", title: "Bulk update failed", description: msg });
    } finally {
      setBulkBusy(false);
    }
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

  function refreshSessionHeader() {
    api.sessions.get(id).then((r) => setSession(r.data)).catch(() => {});
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

  const hasProducts = products.length > 0 || (session?.productsCount ?? 0) > 0;

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
                ? `created ${formatDateTime(session.createdAt)} · ${session.imagesCount} image${session.imagesCount === 1 ? "" : "s"}${session.productsCount ? ` · ${session.productsCount} Etsy product${session.productsCount === 1 ? "" : "s"}` : ""} · ${session.usedCount ?? 0} used`
                : "…"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              onClick={() => {
                setEditingProduct(null);
                setProductFormOpen(true);
              }}
              className="flex h-10 items-center gap-2 border border-brand/50 bg-surface px-4 font-display text-sm font-bold uppercase tracking-widest text-brand transition-colors hover:border-brand hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-brand"
            >
              <Store className="h-4 w-4" aria-hidden />
              Add Etsy product
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

        {/* ── sellable images ── */}
        <section className="space-y-3">
          <h2 className="eyebrow">
            Images — {session ? `${session.imagesCount}` : "…"}
            <span className="ml-2 font-mono text-[10px] normal-case tracking-normal text-ink-muted">
              sold one by one on the stock marketplaces
            </span>
          </h2>
          <FilterBar
            params={list.params}
            onChange={list.updateParams}
            onFilter={list.updateFilter}
            onReset={list.reset}
            searchPlaceholder="Search this session…"
            sortOptions={IMAGE_SORTS}
            hideSearch={false}
          />

          {!list.loading && images.length > 0 && (
            <BulkSelectPanel
              images={images}
              page={list.params.page}
              onApply={(categories, mode) => csvSel.bulkApply(images, categories, mode)}
              onClearAll={csvSel.clear}
            />
          )}

          {list.error && (
            <p className="border border-danger bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{list.error}</p>
          )}

          {list.loading ? (
            <ImageGrid images={[]} loading onOpen={openDetail} onToggleUsed={toggleUsed} />
          ) : images.length === 0 ? (
            <EmptyState
              icon={<Images className="h-6 w-6" aria-hidden />}
              title={list.params.search ? "No image matches" : hasProducts ? "No sellable images in this session" : "No images in this session"}
              hint={
                list.params.search
                  ? "Try another search."
                  : hasProducts
                    ? "This session holds Etsy products (below) — agent runs register sellable images here, or add one manually."
                    : "Agent runs register generated images here. You can also add one manually."
              }
              action={
                !list.params.search && (
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
                )
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
        </section>

        <SelectionBar
          count={csvSel.count}
          originCount={csvSel.list.filter((it) => !it.upscale).length}
          busy={bulkBusy}
          onMarkUsed={() => setBulkMode("mark")}
          onUnmarkUsed={() => setBulkMode("unmark")}
          onDownload={downloadCsv}
          onClear={csvSel.clear}
        />

        {/* ── Etsy products ── */}
        <section className="space-y-3 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="eyebrow">
              Etsy products — {session ? `${session.productsCount ?? 0}` : "…"}
              <span className="ml-2 font-mono text-[10px] normal-case tracking-normal text-ink-muted">
                digital products: several images behind one listing
              </span>
            </h2>
            <button
              type="button"
              onClick={() => {
                setEditingProduct(null);
                setProductFormOpen(true);
              }}
              className="flex h-9 items-center gap-1.5 bg-brand px-3 font-display text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-brand-deep focus-visible:outline-2 focus-visible:outline-brand"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add product
            </button>
          </div>

          {productList.error && (
            <p className="border border-danger bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{productList.error}</p>
          )}

          {productList.loading ? (
            <EtsyProductGrid products={[]} loading />
          ) : products.length === 0 ? (
            <EmptyState
              icon={<Store className="h-6 w-6" aria-hidden />}
              title={productList.params.search ? "No product matches" : "No Etsy products in this session"}
              hint={
                productList.params.search
                  ? "Try another search."
                  : "Etsy agent runs register their products here (coloring books, invitations…) — or add one manually."
              }
              action={
                !productList.params.search && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingProduct(null);
                      setProductFormOpen(true);
                    }}
                    className="flex h-10 items-center gap-2 bg-brand px-4 font-display text-sm font-bold uppercase tracking-widest text-white transition-colors hover:bg-brand-deep"
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    Add the first Etsy product
                  </button>
                )
              }
            />
          ) : (
            <EtsyProductGrid
              products={products}
              onOpen={openProductDetail}
              onDownloadZip={(p) => {
                setZipProduct(p);
                setZipDialogOpen(true);
              }}
            />
          )}

          <PaginationBar pagination={productList.pagination} onChange={productList.updateParams} />
        </section>
      </main>

      <BulkUsedDialog
        open={bulkMode !== null}
        onOpenChange={(open) => !open && setBulkMode(null)}
        mode={bulkMode ?? "mark"}
        items={csvSel.list}
        busy={bulkBusy}
        onConfirm={(platforms) => bulkStampUsed(bulkMode === "unmark", platforms)}
        onClearAll={() => bulkStampUsed(false)}
      />

      <CsvPlatformDialog
        open={csvDialogOpen}
        onOpenChange={setCsvDialogOpen}
        items={csvSel.list}
      />

      <EtsyZipDialog product={zipProduct} open={zipDialogOpen} onOpenChange={setZipDialogOpen} />

      {/* ── image detail (specific to Images to buy) ── */}
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

      {/* ── product detail (specific to Etsy products) ── */}
      <EtsyProductDetailDialog
        product={productDetail}
        onClose={() => setProductDetail(null)}
        onProductUpdate={handleProductUpdate}
        onEdit={(p) => {
          setProductDetail(null);
          setEditingProduct(p);
          setProductFormOpen(true);
        }}
        onDelete={deleteProduct}
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
          refreshSessionHeader();
        }}
      />

      <EtsyProductFormDialog
        open={productFormOpen}
        onOpenChange={setProductFormOpen}
        product={editingProduct}
        fixedSessionId={id}
        sessionOptions={sessionOptions}
        onSaved={(saved) => {
          handleProductUpdate(saved);
          productList.reload();
          refreshSessionHeader();
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
