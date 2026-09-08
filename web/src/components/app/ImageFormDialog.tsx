"use client";

/**
 * Image form dialog — add a new image record or edit an existing one.
 *
 * CREATE: the same form as the edit one — a platform tab selector where the
 * Adobe Stock block (title / category / keywords) is the required BASE and
 * every other platform tab is optional (fill it to store the REAL values for
 * that platform; the API derives the missing ones from the Adobe block).
 *
 * EDIT: the active tab edits THAT platform's metadata block
 * (title/description/categories/keywords per its own format and caps); other
 * blocks are left untouched.
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
import { api, ApiError } from "@/lib/api";
import { CATEGORIES, PLATFORMS, PLATFORM_IDS, RATIOS, SHUTTERSTOCK_CATEGORIES } from "@/lib/constants";
import { parseKeywords } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import type { PlatformId, Quality, StockImage } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ImageFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create mode; requires fixedSessionId or session select */
  image: StockImage | null;
  fixedSessionId?: string;
  sessionOptions: { value: string; label: string }[];
  onSaved: () => void;
}

/** Per-platform editable fields (as form strings). */
interface PlatformForm {
  title: string;
  description: string;
  category: string; // adobe
  ssPrimary: string; // shutterstock primary category
  ssSecondary: string; // shutterstock secondary category (optional)
  keywords: string;
  price: string; // pond5
}

const EMPTY_PLATFORM: PlatformForm = {
  title: "",
  description: "",
  category: "",
  ssPrimary: "",
  ssSecondary: "",
  keywords: "",
  price: "",
};

/** Which fields each platform exposes. */
const PLATFORM_FIELDS: Record<PlatformId, { title?: boolean; description?: boolean; category?: "adobe" | "shutterstock"; keywords: { min: number; max: number }; price?: boolean; titleMax: number; descMax: number }> = {
  adobe_stock: { title: true, category: "adobe", keywords: { min: 3, max: 49 }, titleMax: 200, descMax: 0 },
  shutterstock: { description: true, category: "shutterstock", keywords: { min: 7, max: 50 }, titleMax: 0, descMax: 200 },
  istock: { title: true, description: true, keywords: { min: 1, max: 50 }, titleMax: 120, descMax: 2000 },
  wirestock: { title: true, description: true, keywords: { min: 5, max: 50 }, titleMax: 200, descMax: 1000 },
  pond5: { title: true, description: true, keywords: { min: 5, max: 50 }, price: true, titleMax: 80, descMax: 1000 },
  depositphotos: { description: true, keywords: { min: 8, max: 50 }, titleMax: 0, descMax: 250 },
  "123rf": { description: true, keywords: { min: 7, max: 50 }, titleMax: 0, descMax: 180 },
  dreamstime: { title: true, description: true, keywords: { min: 7, max: 50 }, titleMax: 250, descMax: 2000 },
};

function platformLabelOf(id: PlatformId): string {
  return PLATFORMS.find((p) => p.id === id)?.label ?? id;
}

function loadPlatformForm(image: StockImage | null, platform: PlatformId): PlatformForm {
  const md = (image?.metadata?.[platform] ?? {}) as Record<string, unknown>;
  const keywords = Array.isArray(md.keywords) ? (md.keywords as string[]).join(", ") : "";
  const ssCats = Array.isArray(md.categories) ? (md.categories as string[]) : [];
  return {
    title: typeof md.title === "string" ? md.title : "",
    description: typeof md.description === "string" ? md.description : "",
    category: (image?.metadata?.adobe_stock?.category ?? image?.category ?? "") as string,
    ssPrimary: ssCats[0] ?? "",
    ssSecondary: ssCats[1] ?? "",
    keywords,
    price: typeof md.price === "number" ? String(md.price) : "",
  };
}

export function ImageFormDialog({
  open,
  onOpenChange,
  image,
  fixedSessionId,
  sessionOptions,
  onSaved,
}: ImageFormDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<PlatformForm & { session_id: string; prompt: string; image_link: string; ratio: string; quality: Quality }>({
    ...EMPTY_PLATFORM,
    session_id: "",
    prompt: "",
    image_link: "",
    ratio: "1:1",
    quality: "1K",
  });
  const [platform, setPlatform] = useState<PlatformId>("adobe_stock");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const editing = !!image;

  /** Per-platform drafts (tab switching) — declared before the reset block
   *  because the reset clears them. */
  const [drafts, setDrafts] = useState<Partial<Record<PlatformId, PlatformForm>>>({});

  // Reset the form when the dialog opens (adjust-state-during-render pattern).
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevImage, setPrevImage] = useState<StockImage | null>(image);
  if (prevOpen !== open || prevImage !== image) {
    setPrevOpen(open);
    setPrevImage(image);
    if (open) {
      setErrors({});
      setDrafts({});
      if (image) {
        setPlatform("adobe_stock");
        setForm({
          ...loadPlatformForm(image, "adobe_stock"),
          session_id: image.session_id,
          prompt: image.prompt,
          image_link: image.image_link,
          ratio: RATIOS.includes(image.ratio as (typeof RATIOS)[number]) ? image.ratio : "1:1",
          quality: image.quality as Quality,
        });
      } else {
        setPlatform("adobe_stock");
        setForm({ ...EMPTY_PLATFORM, session_id: fixedSessionId || "", prompt: "", image_link: "", ratio: "1:1", quality: "1K" });
      }
    }
  }

  function set<K extends keyof (PlatformForm & { session_id: string; prompt: string; image_link: string; ratio: string; quality: Quality })>(
    key: K,
    value: (PlatformForm & { session_id: string; prompt: string; image_link: string; ratio: string; quality: Quality })[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: "" }));
  }

  /** Switch platform tab — save the current block into a draft map, load the
   *  new one from the image (edit) or from the draft / empty (create). */
  function switchPlatform(next: PlatformId) {
    setDrafts((d) => ({ ...d, [platform]: { ...form } }));
    const draft = drafts[next];
    if (editing) {
      const fromImage = loadPlatformForm(image, next);
      setForm((f) => ({
        ...f,
        ...(draft ?? {
          title: fromImage.title,
          description: fromImage.description,
          category: platform === "adobe_stock" ? f.category : fromImage.category,
          ssPrimary: fromImage.ssPrimary,
          ssSecondary: fromImage.ssSecondary,
          keywords: fromImage.keywords,
          price: fromImage.price,
        }),
      }));
    } else {
      setForm((f) => ({ ...f, ...(draft ?? { ...EMPTY_PLATFORM }) }));
    }
    setPlatform(next);
    setErrors({});
  }

  /** True when a create-mode draft block carries any user content (also
   *  narrows the type for the save path). */
  function draftFilled(d: PlatformForm | undefined): d is PlatformForm {
    if (!d) return false;
    return Boolean(
      d.title.trim() || d.description.trim() || d.category || d.ssPrimary ||
      d.ssSecondary || d.keywords.trim() || d.price.trim(),
    );
  }

  /** Validate one platform block (form or draft) — returns field errors. */
  function validateBlock(id: PlatformId, f: PlatformForm, kws: string[]): Record<string, string> {
    const e: Record<string, string> = {};
    const fields = PLATFORM_FIELDS[id];
    const label = platformLabelOf(id);
    if (fields.title) {
      if (f.title.trim().length < 3) e.title = "At least 3 characters";
      if (f.title.trim().length > fields.titleMax) e.title = `At most ${fields.titleMax} characters (${label} limit)`;
    }
    if (fields.description) {
      if (f.description.trim().length < 5) e.description = "At least 5 characters";
      if (f.description.trim().length > fields.descMax) e.description = `At most ${fields.descMax} characters (${label} limit)`;
    }
    if (fields.category === "adobe" && !f.category) e.category = "Choose one of the 21 Adobe Stock categories";
    if (fields.category === "shutterstock" && !f.ssPrimary) e.ssPrimary = "Choose a primary category";
    if (fields.price && f.price.trim() && !(Number(f.price) > 0)) e.price = "Must be a positive USD amount";
    if (kws.length < fields.keywords.min) {
      e.keywords = `At least ${fields.keywords.min} keywords (${label} minimum)`;
    }
    if (kws.length > fields.keywords.max) {
      e.keywords = `At most ${fields.keywords.max} keywords (${label} limit)`;
    }
    return e;
  }

  const fields = PLATFORM_FIELDS[platform];
  const keywords = parseKeywords(form.keywords);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.session_id) e.session_id = "Choose a session";
    if (!form.prompt.trim()) e.prompt = "The generation prompt is required";
    if (!editing) {
      if (!/^https?:\/\/.+/.test(form.image_link.trim())) e.image_link = 'Must be an http(s) URL like "https://…/image.png"';
      if (!form.ratio) e.ratio = "Required";
      if (!form.quality) e.quality = "Required";
    }

    // active tab block
    Object.assign(e, validateBlock(platform, form, keywords));

    if (!editing) {
      // Adobe block is the REQUIRED base — validate its draft even when the
      // user sits on another tab (errors point back to the Adobe tab).
      if (platform !== "adobe_stock") {
        const adobeDraft = drafts.adobe_stock;
        const adobeForm: PlatformForm = adobeDraft ?? EMPTY_PLATFORM;
        const adobeErrors = validateBlock("adobe_stock", adobeForm, parseKeywords(adobeForm.keywords));
        for (const [k, v] of Object.entries(adobeErrors)) {
          e[`adobe-${k}`] = v;
        }
      }
      // every OTHER filled draft must be a complete, valid block
      for (const id of PLATFORM_IDS) {
        if (id === "adobe_stock" || id === platform) continue;
        const d = drafts[id];
        if (!draftFilled(d) || !d) continue;
        const errs = validateBlock(id, d, parseKeywords(d.keywords));
        if (Object.keys(errs).length > 0) {
          e[`platform-${id}`] = `${platformLabelOf(id)} block incomplete — open its tab to fix it`;
        }
      }
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  /** Build the API metadata block of one platform from its form values. */
  function buildBlock(id: PlatformId, f: PlatformForm, kws: string[]): Record<string, unknown> {
    const fields = PLATFORM_FIELDS[id];
    const block: Record<string, unknown> = {};
    if (fields.title) block.title = f.title.trim();
    if (fields.description) block.description = f.description.trim();
    if (fields.category === "adobe") block.category = f.category;
    if (fields.category === "shutterstock") block.categories = [f.ssPrimary, f.ssSecondary].filter(Boolean);
    if (fields.price && f.price.trim()) block.price = Number(f.price);
    block.keywords = kws;
    return block;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    try {
      if (editing && image) {
        // PATCH: common fields + the ACTIVE platform's metadata block
        const block = buildBlock(platform, form, keywords);

        await api.images.update(image._id, {
          ...(form.session_id !== image.session_id ? { session_id: form.session_id } : {}),
          prompt: form.prompt.trim(),
          ...(form.image_link.trim() !== image.image_link ? { image_link: form.image_link.trim() } : {}),
          ratio: form.ratio,
          quality: form.quality,
          metadata: { [platform]: block } as StockImage["metadata"],
        });
        toast({ title: "Image updated", description: `${platformLabelOf(platform)} metadata saved.` });
      } else {
        // CREATE: Adobe block (required base) + every other filled draft —
        // the API derives the platforms left empty.
        const adobeForm: PlatformForm = platform === "adobe_stock" ? form : drafts.adobe_stock ?? EMPTY_PLATFORM;
        const adobeKeywords = parseKeywords(adobeForm.keywords);
        const metadata: Record<string, unknown> = {
          adobe_stock: buildBlock("adobe_stock", adobeForm, adobeKeywords),
        };
        for (const id of PLATFORM_IDS) {
          if (id === "adobe_stock") continue;
          const d = platform === id ? form : drafts[id];
          if (draftFilled(d)) {
            metadata[id] = buildBlock(id, d, parseKeywords(d.keywords));
          }
        }
        await api.images.create({
          session_id: form.session_id,
          prompt: form.prompt.trim(),
          image_link: form.image_link.trim(),
          ratio: form.ratio,
          quality: form.quality,
          metadata: metadata as StockImage["metadata"],
        });
        toast({
          title: "Image added",
          description: "Metadata stored — empty platform blocks were auto-derived from the Adobe one.",
        });
      }
      setDrafts({});
      onOpenChange(false);
      onSaved();
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

  const err = (k: string) =>
    errors[k] ? <p className="mt-1 text-xs text-danger" role="alert">{errors[k]}</p> : null;

  const inputCls = "h-9 rounded-none border-line-strong";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-y-auto rounded-none border-ink bg-surface p-0 shadow-[var(--shadow-hard)] sm:max-w-xl">
        <DialogHeader className="border-b border-line p-4">
          <DialogTitle className="font-display text-lg font-bold uppercase tracking-wide">
            {editing ? "Edit image" : "Add image"}
          </DialogTitle>
          <DialogDescription className="text-sm text-ink-muted">
            {editing
              ? "Pick a platform tab to edit its metadata, or fix the common fields. Other platforms are untouched."
              : "Fill the Adobe Stock tab (required base) — open any other tab to store its REAL values; the platforms left empty are auto-derived from Adobe."}
          </DialogDescription>
        </DialogHeader>

        {/* platform tabs (both modes — the same form when adding as when editing) */}
        <div className="flex flex-wrap gap-1 border-b border-line bg-paper p-2" role="tablist" aria-label="Platform metadata">
          {PLATFORMS.map((p) => {
            const has = editing
              ? Boolean(image?.metadata?.[p.id])
              : p.id === "adobe_stock" || draftFilled(drafts[p.id]);
            const used = image?.used?.[p.id] === true;
            return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={platform === p.id}
                  onClick={() => switchPlatform(p.id)}
                  className={cn(
                    "chip border-line-strong transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                    platform === p.id ? "border-ink bg-ink text-paper" : "bg-surface text-ink hover:border-ink",
                    !has && "opacity-60",
                  )}
                  title={has ? `${p.label} metadata` : `${p.label} — no metadata yet`}
                >
                  {p.label}
                  {used ? " ·" : ""}
                </button>
              );
            })}
        </div>

        {/* draft validation errors (create mode — shown under the tabs) */}
        {!editing && (err("adobe-title") || err("adobe-category") || err("adobe-keywords")) && (
          <p className="border-b border-danger/40 bg-danger-soft px-4 py-2 text-xs text-danger" role="alert">
            Adobe Stock tab (the required base) is incomplete — open it to fix: {["adobe-title", "adobe-category", "adobe-keywords"].filter((k) => errors[k]).join(", ").replace(/adobe-/g, "")}.
          </p>
        )}
        {!editing && Object.keys(errors).some((k) => k.startsWith("platform-")) && (
          <div className="space-y-0.5 border-b border-danger/40 bg-danger-soft px-4 py-2 text-xs text-danger" role="alert">
            {Object.entries(errors)
              .filter(([k]) => k.startsWith("platform-"))
              .map(([k, v]) => (
                <p key={k}>{v}</p>
              ))}
          </div>
        )}

        <div className="grid gap-4 p-4 sm:grid-cols-2">
          {/* ── platform block ── */}
          {fields.title && (
            <div className="sm:col-span-2">
              <Label htmlFor="img-title" className="eyebrow">
                {platformLabelOf(platform)} — title
              </Label>
              <Input
                id="img-title"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                className={inputCls}
                placeholder="Minimal ceramic cups on linen, top view"
                maxLength={fields.titleMax}
              />
              {err("title")}
            </div>
          )}

          {fields.description && (
            <div className="sm:col-span-2">
              <Label htmlFor="img-desc" className="eyebrow">
                {platformLabelOf(editing ? platform : "adobe_stock")} — description (≤ {fields.descMax})
              </Label>
              <Textarea
                id="img-desc"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                className="min-h-[60px] rounded-none border-line-strong font-mono text-[12.5px]"
                placeholder="A complete descriptive sentence of at least five words…"
                maxLength={fields.descMax}
              />
              {err("description")}
            </div>
          )}

          {fields.category === "adobe" && (
            <div>
              <Label className="eyebrow">Adobe Stock category</Label>
              <Select value={form.category || "none"} onValueChange={(v) => set("category", v === "none" ? "" : v)}>
                <SelectTrigger className={`${inputCls} w-full font-mono text-[13px]`} aria-label="Category">
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-none border-ink font-mono text-[13px]">
                  <SelectItem value="none">Choose…</SelectItem>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {err("category")}
            </div>
          )}

          {fields.category === "shutterstock" && (
            <>
              <div>
                <Label className="eyebrow">Shutterstock category 1</Label>
                <Select value={form.ssPrimary || "none"} onValueChange={(v) => set("ssPrimary", v === "none" ? "" : v)}>
                  <SelectTrigger className={`${inputCls} w-full font-mono text-[13px]`} aria-label="Primary category">
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 rounded-none border-ink font-mono text-[13px]">
                    <SelectItem value="none">Choose…</SelectItem>
                    {SHUTTERSTOCK_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {err("ssPrimary")}
              </div>
              <div>
                <Label className="eyebrow">Category 2 (optional)</Label>
                <Select value={form.ssSecondary || "none"} onValueChange={(v) => set("ssSecondary", v === "none" ? "" : v)}>
                  <SelectTrigger className={`${inputCls} w-full font-mono text-[13px]`} aria-label="Secondary category">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 rounded-none border-ink font-mono text-[13px]">
                    <SelectItem value="none">None</SelectItem>
                    {SHUTTERSTOCK_CATEGORIES.filter((c) => c !== form.ssPrimary).map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {fields.price && (
            <div>
              <Label htmlFor="img-price" className="eyebrow">Pond5 price (USD)</Label>
              <Input
                id="img-price"
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
                className={`${inputCls} font-mono text-[13px]`}
                placeholder="5"
                inputMode="decimal"
              />
              {err("price")}
            </div>
          )}

          <div className="sm:col-span-2">
            <Label htmlFor="img-keywords" className="eyebrow">
              Keywords — comma separated ({keywords.length}/{fields.keywords.max})
            </Label>
            <Textarea
              id="img-keywords"
              value={form.keywords}
              onChange={(e) => set("keywords", e.target.value)}
              className="min-h-[70px] rounded-none border-line-strong font-mono text-[12.5px]"
              placeholder="ceramic cup, linen, minimalism, still life, top view, …"
            />
            {err("keywords")}
          </div>

          {/* ── common fields ── */}
          <div className="sm:col-span-2">
            <Label htmlFor="img-prompt" className="eyebrow">Prompt</Label>
            <Textarea
              id="img-prompt"
              value={form.prompt}
              onChange={(e) => set("prompt", e.target.value)}
              className="min-h-[84px] rounded-none border-line-strong font-mono text-[12.5px]"
              placeholder="The exact prompt used to generate this image…"
            />
            {err("prompt")}
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="img-link" className="eyebrow">Image URL {editing && "(leave unchanged if fine)"}</Label>
            <Input
              id="img-link"
              value={form.image_link}
              onChange={(e) => set("image_link", e.target.value)}
              className={`${inputCls} font-mono text-[12.5px]`}
              placeholder="https://…/image.png"
            />
            {err("image_link")}
          </div>

          <div>
            <Label className="eyebrow">Session</Label>
            <Select
              value={form.session_id || "none"}
              onValueChange={(v) => set("session_id", v === "none" ? "" : v)}
              disabled={!!fixedSessionId}
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="eyebrow">Ratio</Label>
              <Select value={form.ratio} onValueChange={(v) => set("ratio", v)}>
                <SelectTrigger className={`${inputCls} w-full font-mono text-[13px]`} aria-label="Aspect ratio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-none border-ink font-mono text-[13px]">
                  {RATIOS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {err("ratio")}
            </div>
            <div>
              <Label className="eyebrow">Quality</Label>
              <Select value={form.quality} onValueChange={(v) => set("quality", v as Quality)}>
                <SelectTrigger className={`${inputCls} w-full font-mono text-[13px]`} aria-label="Quality">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-none border-ink font-mono text-[13px]">
                  {["1K", "2K", "4K"].map((q) => (
                    <SelectItem key={q} value={q}>{q}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {err("quality")}
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
            {saving ? "Saving…" : editing ? "Save changes" : "Add image"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
