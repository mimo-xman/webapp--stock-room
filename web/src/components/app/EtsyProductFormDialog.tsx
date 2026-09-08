"use client";

/**
 * Etsy product form dialog — create a product manually or edit an existing
 * one (the owner asked for a real fix form, replacing the old
 * "use PATCH /api/etsy-products/:id" toast).
 *
 * PRODUCT FIELDS (PATCH on save, metadata merged server-side):
 *   product_type · metadata {title, description, tags, category, price} ·
 *   file_link · used_in_etsy
 *
 * IMAGES — managed through the DEDICATED endpoints (a wholesale images
 * PATCH would drop every nested _id / upscales / worker field):
 *   · existing images: edit role / caption / link inline, remove (except the
 *     last one — a product always needs ≥ 1 image)
 *   · new images: append rows (link + role — cover / page / asset / preview /
 *     marketing) applied on save via POST /:id/images
 * In CREATE mode the images are part of the single POST body (≥ 1 required).
 *
 * Client-side validation mirrors the server's zod rules.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { ETSY_IMAGE_ROLES, ETSY_PRODUCT_TYPES, RATIOS } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import type { EtsyImageRole, EtsyProduct, EtsyProductImage, EtsyProductType, Quality } from "@/lib/types";
import { cn } from "@/lib/utils";

interface EtsyProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create mode; requires fixedSessionId or session select */
  product: EtsyProduct | null;
  fixedSessionId?: string;
  sessionOptions: { value: string; label: string }[];
  onSaved: (product: EtsyProduct) => void;
}

/** A form row for ONE image (create mode / appended rows in edit mode). */
interface ImageDraft {
  key: string;
  image_link: string;
  role: EtsyImageRole;
  caption: string;
  prompt: string;
  ratio: string;
  quality: Quality;
}

/** An existing image with its LOCAL edits (applied via per-image PATCH). */
interface ExistingImage {
  _id: string;
  image_link: string;
  role: EtsyImageRole;
  caption: string;
  remove: boolean;
}

function newDraft(): ImageDraft {
  return {
    key: Math.random().toString(36).slice(2),
    image_link: "",
    role: "page",
    caption: "",
    prompt: "",
    ratio: "3:4",
    quality: "2K",
  };
}

function parseTags(s: string): string[] {
  return s
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

let draftSeq = 0;

export function EtsyProductFormDialog({
  open,
  onOpenChange,
  product,
  fixedSessionId,
  sessionOptions,
  onSaved,
}: EtsyProductFormDialogProps) {
  const { toast } = useToast();
  const editing = !!product;

  const [form, setForm] = useState({
    session_id: "",
    product_type: "coloring_book" as EtsyProductType,
    title: "",
    description: "",
    tags: "",
    category: "",
    price: "",
    file_link: "",
    used_in_etsy: false,
  });
  const [existing, setExisting] = useState<ExistingImage[]>([]);
  const [drafts, setDrafts] = useState<ImageDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Reset the form when the dialog opens (adjust-during-render pattern).
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevProduct, setPrevProduct] = useState<EtsyProduct | null>(product);
  if (prevOpen !== open || prevProduct !== product) {
    setPrevOpen(open);
    setPrevProduct(product);
    if (open) {
      setErrors({});
      if (product) {
        setForm({
          session_id: product.session_id,
          product_type: product.product_type,
          title: product.metadata.title ?? "",
          description: product.metadata.description ?? "",
          tags: (product.metadata.tags ?? []).join(", "),
          category: product.metadata.category ?? "",
          price: typeof product.metadata.price === "number" ? String(product.metadata.price) : "",
          file_link: product.file_link ?? "",
          used_in_etsy: product.used_in_etsy === true,
        });
        setExisting(
          product.images.map((im) => ({
            _id: im._id ?? "",
            image_link: im.image_link,
            role: im.role,
            caption: im.caption ?? "",
            remove: false,
          })),
        );
      } else {
        setForm({
          session_id: fixedSessionId || "",
          product_type: "coloring_book",
          title: "",
          description: "",
          tags: "",
          category: "",
          price: "",
          file_link: "",
          used_in_etsy: false,
        });
        setExisting([]);
      }
      setDrafts([newDraft()]);
    }
  }

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: "" }));
  }

  function setDraft(key: string, patch: Partial<ImageDraft>) {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    setErrors((e) => ({ ...e, [`draft-${key}`]: "" }));
  }

  function setExistingImage(id: string, patch: Partial<ExistingImage>) {
    setExisting((xs) => xs.map((x) => (x._id === id ? { ...x, ...patch } : x)));
    setErrors((e) => ({ ...e, [`existing-${id}`]: "" }));
  }

  const tags = parseTags(form.tags);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.session_id) e.session_id = "Choose a session";
    if (!editing || form.title.trim() !== (product?.metadata.title ?? "")) {
      if (form.title.trim().length < 3) e.title = "At least 3 characters";
      if (form.title.trim().length > 140) e.title = "At most 140 characters (Etsy limit)";
    }
    if (!editing || form.description.trim() !== (product?.metadata.description ?? "")) {
      if (form.description.trim().length < 10) e.description = "At least 10 characters";
    }
    if (tags.length > 13) e.tags = "At most 13 tags (Etsy limit)";
    if (tags.some((t) => t.length > 20)) e.tags = "Each tag must be ≤ 20 characters (Etsy limit)";
    if (form.price.trim() && !(Number(form.price) >= 0.2)) e.price = "Etsy minimum is $0.20";
    if (form.file_link.trim() && !/^https?:\/\/.+/.test(form.file_link.trim()))
      e.file_link = 'Must be an http(s) URL like "https://…/book.pdf"';

    const keptImages = existing.filter((x) => !x.remove);
    const validDrafts = drafts.filter((d) => d.image_link.trim() || d.caption.trim());

    if (!editing) {
      // create: at least one valid image row
      if (validDrafts.length < 1) {
        e["drafts"] = "Add at least one image (the cover)";
      }
    } else if (keptImages.length + validDrafts.length < 1) {
      e["drafts"] = "A product needs at least one image — un-remove one or add a new one";
    }

    for (const d of validDrafts) {
      if (!/^https?:\/\/.+/.test(d.image_link.trim())) {
        e[`draft-${d.key}`] = 'Image URL must be http(s), like "https://…/page.png"';
      }
      if (d.caption.trim().length > 200) e[`draft-${d.key}`] = "Caption must be ≤ 200 characters";
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    try {
      if (editing && product) {
        // ── EDIT: product fields via PATCH (metadata merged server-side) ──
        const tagChanged = tags.join(",") !== (product.metadata.tags ?? []).join(",");
        await api.etsyProducts.update(product._id, {
          ...(form.session_id !== product.session_id ? { session_id: form.session_id } : {}),
          product_type: form.product_type,
          metadata: {
            title: form.title.trim(),
            description: form.description.trim(),
            ...(tagChanged ? { tags } : {}),
            category: form.category.trim(),
            ...(form.price.trim() ? { price: Number(form.price) } : {}),
          },
          file_link: form.file_link.trim(),
          used_in_etsy: form.used_in_etsy,
        });

        // ── per-image edits via the dedicated endpoints ──
        for (const x of existing) {
          const before = product.images.find((im) => im._id === x._id);
          if (x.remove) {
            await api.etsyProducts.images.remove(product._id, x._id);
            continue;
          }
          const patch: { role?: EtsyImageRole; caption?: string; image_link?: string } = {};
          if (before && before.role !== x.role) patch.role = x.role;
          if (before && (before.caption ?? "") !== x.caption) patch.caption = x.caption;
          if (before && before.image_link !== x.image_link) patch.image_link = x.image_link.trim();
          if (Object.keys(patch).length > 0) {
            await api.etsyProducts.images.update(product._id, x._id, patch);
          }
        }
        for (const d of drafts.filter((d) => d.image_link.trim())) {
          await api.etsyProducts.addImage(product._id, draftToPayload(d));
        }

        const res = await api.etsyProducts.get(product._id);
        onSaved(res.data);
        toast({ title: "Product updated", description: form.title.trim() });
      } else {
        // ── CREATE: one POST with everything ──
        const res = await api.etsyProducts.create({
          session_id: form.session_id,
          product_type: form.product_type,
          images: drafts.filter((d) => d.image_link.trim()).map(draftToPayload),
          metadata: {
            title: form.title.trim(),
            description: form.description.trim(),
            tags,
            category: form.category.trim(),
            ...(form.price.trim() ? { price: Number(form.price) } : {}),
          },
          file_link: form.file_link.trim(),
          used_in_etsy: form.used_in_etsy,
        });
        onSaved(res.data);
        toast({
          title: "Etsy product added",
          description: `${form.title.trim()} — ${res.data.images.length} image(s).`,
        });
      }
      onOpenChange(false);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      if (apiErr?.payload?.details?.length) {
        const map: Record<string, string> = {};
        for (const d of apiErr.payload.details) map[d.path] = d.message;
        setErrors(map);
      }
      toast({
        variant: "destructive",
        title: "Save failed",
        description: apiErr?.payload?.message || "Check the fields and try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  function draftToPayload(d: ImageDraft): Partial<EtsyProductImage> {
    return {
      image_link: d.image_link.trim(),
      role: d.role,
      caption: d.caption.trim(),
      prompt: d.prompt.trim(),
      ratio: d.ratio,
      quality: d.quality,
    };
  }

  const err = (k: string) =>
    errors[k] ? <p className="mt-1 text-xs text-danger" role="alert">{errors[k]}</p> : null;

  const inputCls = "h-9 rounded-none border-line-strong";
  const keptCount = existing.filter((x) => !x.remove).length + drafts.filter((d) => d.image_link.trim()).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-y-auto rounded-none border-ink bg-surface p-0 shadow-[var(--shadow-hard)] sm:max-w-2xl">
        <DialogHeader className="border-b border-line p-4">
          <DialogTitle className="font-display text-lg font-bold uppercase tracking-wide">
            {editing ? "Edit Etsy product" : "Add Etsy product"}
          </DialogTitle>
          <DialogDescription className="text-sm text-ink-muted">
            {editing
              ? "Fix the listing metadata, manage the product images (role, caption, removal) or append new ones."
              : "Register a digital product for Etsy: its images (cover, pages, marketing) behind one shared listing metadata block."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 p-4 sm:grid-cols-2">
          {/* ── listing metadata ── */}
          <div className="sm:col-span-2">
            <Label htmlFor="ep-title" className="eyebrow">
              Listing title ({form.title.trim().length}/140 — Etsy limit)
            </Label>
            <Input
              id="ep-title"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              className={inputCls}
              placeholder="Printable Coloring Book – Construction Vehicles – 20 Pages – Instant Download"
              maxLength={140}
            />
            {err("title")}
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="ep-desc" className="eyebrow">Listing description</Label>
            <Textarea
              id="ep-desc"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              className="min-h-[90px] rounded-none border-line-strong font-mono text-[12.5px]"
              placeholder="A warm pitch: what it is, what is included, instant download, print at home…"
            />
            {err("description")}
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="ep-tags" className="eyebrow">
              Tags — comma separated ({tags.length}/13, each ≤ 20 chars)
            </Label>
            <Input
              id="ep-tags"
              value={form.tags}
              onChange={(e) => set("tags", e.target.value)}
              className={`${inputCls} font-mono text-[12.5px]`}
              placeholder="coloring book, printable, kids activity, digital download…"
            />
            {err("tags")}
          </div>

          <div>
            <Label className="eyebrow">Product type</Label>
            <Select value={form.product_type} onValueChange={(v) => set("product_type", v as EtsyProductType)}>
              <SelectTrigger className={`${inputCls} w-full font-mono text-[13px]`} aria-label="Product type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72 rounded-none border-ink font-mono text-[13px]">
                {ETSY_PRODUCT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="ep-price" className="eyebrow">Price (USD, ≥ $0.20)</Label>
            <Input
              id="ep-price"
              value={form.price}
              onChange={(e) => set("price", e.target.value)}
              className={`${inputCls} font-mono text-[13px]`}
              placeholder="4.99"
              inputMode="decimal"
            />
            {err("price")}
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="ep-category" className="eyebrow">Etsy category (taxonomy path)</Label>
            <Input
              id="ep-category"
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              className={inputCls}
              placeholder="Toys & Games > Games > Coloring Books"
              maxLength={200}
            />
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="ep-file" className="eyebrow">Deliverable file URL — optional (assembled PDF/ZIP)</Label>
            <Input
              id="ep-file"
              value={form.file_link}
              onChange={(e) => set("file_link", e.target.value)}
              className={`${inputCls} font-mono text-[12.5px]`}
              placeholder="https://…/coloring-book.pdf"
            />
            {err("file_link")}
          </div>

          <div className="sm:col-span-2 flex items-center gap-2">
            <input
              id="ep-used"
              type="checkbox"
              checked={form.used_in_etsy}
              onChange={(e) => set("used_in_etsy", e.target.checked)}
              className="h-4 w-4 rounded-none accent-[var(--brand)]"
            />
            <Label htmlFor="ep-used" className="text-sm">
              Listed on Etsy already
            </Label>
          </div>

          {!fixedSessionId && (
            <div className="sm:col-span-2">
              <Label className="eyebrow">Session</Label>
              <Select
                value={form.session_id || "none"}
                onValueChange={(v) => set("session_id", v === "none" ? "" : v)}
              >
                <SelectTrigger className={`${inputCls} w-full font-mono text-[13px]`} aria-label="Session">
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-none border-ink font-mono text-[13px]">
                  <SelectItem value="none">Choose…</SelectItem>
                  {sessionOptions.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {err("session_id")}
            </div>
          )}

          {/* ── images ── */}
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="eyebrow">
                Images ({editing ? `${keptCount} kept` : `${drafts.length} row(s)`})
                {editing && existing.some((x) => x.remove) && (
                  <span className="ml-2 font-mono text-[10px] normal-case tracking-normal text-danger">
                    {existing.filter((x) => x.remove).length} to remove
                  </span>
                )}
              </h4>
              <button
                type="button"
                onClick={() => setDrafts((ds) => [...ds, { ...newDraft(), key: `d${++draftSeq}` }])}
                className="flex h-7 items-center gap-1 border border-line-strong bg-surface px-2 font-display text-[10.5px] font-semibold uppercase tracking-wider text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-brand"
              >
                <Plus className="h-3 w-3" aria-hidden />
                Add image
              </button>
            </div>
            {err("drafts")}

            <div className="mt-1.5 space-y-2">
              {/* existing images (edit mode) */}
              {existing.map((x) => (
                <div
                  key={x._id}
                  className={cn(
                    "border bg-paper p-2.5",
                    x.remove ? "border-danger/50 opacity-60" : "border-line",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10.5px] text-ink-muted">
                      {x._id.slice(0, 8)}…
                    </span>
                    <Select value={x.role} onValueChange={(v) => setExistingImage(x._id, { role: v as EtsyImageRole })}>
                      <SelectTrigger
                        className="h-7 w-[210px] rounded-none border-line-strong font-mono text-[11px]"
                        aria-label={`Role of image ${x._id}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-60 rounded-none border-ink font-mono text-[11px]">
                        {ETSY_IMAGE_ROLES.map((r) => (
                          <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      onClick={() => setExistingImage(x._id, { remove: !x.remove })}
                      className={cn(
                        "ml-auto flex h-7 items-center gap-1 border px-2 font-display text-[10.5px] font-semibold uppercase tracking-wider transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                        x.remove
                          ? "border-line-strong bg-surface text-ink hover:border-ink"
                          : "border-danger/40 bg-surface text-danger hover:border-danger hover:bg-danger-soft",
                      )}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                      {x.remove ? "Undo" : "Remove"}
                    </button>
                  </div>
                  <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                    <Input
                      value={x.caption}
                      onChange={(e) => setExistingImage(x._id, { caption: e.target.value })}
                      className="h-8 rounded-none border-line-strong font-mono text-[11.5px]"
                      placeholder="Caption — e.g. Busy Machines — Page 7: Cement Mixer"
                      maxLength={200}
                    />
                    <Input
                      value={x.image_link}
                      onChange={(e) => setExistingImage(x._id, { image_link: e.target.value })}
                      className="h-8 rounded-none border-line-strong font-mono text-[11.5px]"
                      placeholder="https://…/page.png (fix a dead link here)"
                    />
                  </div>
                </div>
              ))}

              {/* new image rows */}
              {drafts.map((d, i) => (
                <div key={d.key} className="border border-dashed border-line-strong bg-paper p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-ink-muted">
                      {editing ? "New" : `#${i + 1}`}
                    </span>
                    <Select value={d.role} onValueChange={(v) => setDraft(d.key, { role: v as EtsyImageRole })}>
                      <SelectTrigger
                        className="h-7 w-[210px] rounded-none border-line-strong font-mono text-[11px]"
                        aria-label={`Role of image row ${i + 1}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-60 rounded-none border-ink font-mono text-[11px]">
                        {ETSY_IMAGE_ROLES.map((r) => (
                          <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={d.ratio} onValueChange={(v) => setDraft(d.key, { ratio: v })}>
                      <SelectTrigger
                        className="h-7 w-[90px] rounded-none border-line-strong font-mono text-[11px]"
                        aria-label={`Ratio of image row ${i + 1}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-none border-ink font-mono text-[11px]">
                        {RATIOS.map((r) => (
                          <SelectItem key={r} value={r}>{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={d.quality} onValueChange={(v) => setDraft(d.key, { quality: v as Quality })}>
                      <SelectTrigger
                        className="h-7 w-[80px] rounded-none border-line-strong font-mono text-[11px]"
                        aria-label={`Quality of image row ${i + 1}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-none border-ink font-mono text-[11px]">
                        {["1K", "2K", "4K"].map((q) => (
                          <SelectItem key={q} value={q}>{q}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {drafts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                        className="ml-auto flex h-7 w-7 items-center justify-center border border-danger/40 bg-surface text-danger transition-colors hover:border-danger hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-brand"
                        aria-label={`Remove image row ${i + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    )}
                  </div>
                  <div className="mt-1.5 space-y-1.5">
                    <Input
                      value={d.image_link}
                      onChange={(e) => setDraft(d.key, { image_link: e.target.value })}
                      className="h-8 rounded-none border-line-strong font-mono text-[11.5px]"
                      placeholder="https://…/image.png"
                    />
                    <Input
                      value={d.caption}
                      onChange={(e) => setDraft(d.key, { caption: e.target.value })}
                      className="h-8 rounded-none border-line-strong font-mono text-[11.5px]"
                      placeholder="Caption — e.g. Busy Machines — Cover"
                      maxLength={200}
                    />
                    <Input
                      value={d.prompt}
                      onChange={(e) => setDraft(d.key, { prompt: e.target.value })}
                      className="h-8 rounded-none border-line-strong font-mono text-[11.5px]"
                      placeholder="Generation prompt (optional, traceability)"
                    />
                    {err(`draft-${d.key}`)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-line bg-paper p-3 sm:gap-0">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-none border border-ink/30 bg-surface px-4 font-display text-xs font-semibold uppercase tracking-widest text-ink hover:border-ink focus-visible:outline-2 focus-visible:outline-brand"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-9 rounded-none bg-brand px-5 font-display text-xs font-bold uppercase tracking-widest text-white hover:bg-brand-deep disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-brand"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Add product"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
