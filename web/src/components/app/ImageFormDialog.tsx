"use client";

/**
 * Image form dialog — add a new image record or edit an existing one.
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { CATEGORIES, QUALITIES, RATIOS } from "@/lib/constants";
import { parseKeywords } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import type { Quality, StockImage } from "@/lib/types";

interface ImageFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create mode; requires fixedSessionId or session select */
  image: StockImage | null;
  fixedSessionId?: string;
  sessionOptions: { value: string; label: string }[];
  onSaved: () => void;
}

interface FormState {
  session_id: string;
  title: string;
  category: string;
  keywords: string;
  prompt: string;
  image_link: string;
  ratio: string;
  quality: Quality;
  used_in_adobe_stock: boolean;
}

const EMPTY: FormState = {
  session_id: "",
  title: "",
  category: "",
  keywords: "",
  prompt: "",
  image_link: "",
  ratio: "1:1",
  quality: "1K" as Quality,
  used_in_adobe_stock: false,
};

export function ImageFormDialog({
  open,
  onOpenChange,
  image,
  fixedSessionId,
  sessionOptions,
  onSaved,
}: ImageFormDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const editing = !!image;

  // Reset the form when the dialog opens (adjust-state-during-render pattern).
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevImage, setPrevImage] = useState<StockImage | null>(image);
  if (prevOpen !== open || prevImage !== image) {
    setPrevOpen(open);
    setPrevImage(image);
    if (open) {
      setErrors({});
      if (image) {
        setForm({
          session_id: image.session_id,
          title: image.title,
          category: image.category,
          keywords: image.keywords.join(", "),
          prompt: image.prompt,
          image_link: image.image_link,
          ratio: RATIOS.includes(image.ratio as (typeof RATIOS)[number]) ? image.ratio : "1:1",
          quality: image.quality as Quality,
          used_in_adobe_stock: image.used_in_adobe_stock,
        });
      } else {
        setForm({ ...EMPTY, session_id: fixedSessionId || "" });
      }
    }
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: "" }));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.session_id) e.session_id = "Choose a session";
    if (form.title.trim().length < 3) e.title = "At least 3 characters";
    if (form.title.trim().length > 200) e.title = "At most 200 characters (API limit)";
    if (!form.category) e.category = "Choose one of the 21 Stock Room categories";
    const kw = parseKeywords(form.keywords);
    if (kw.length < 3) e.keywords = "At least 3 keywords (comma separated)";
    if (kw.length > 50) e.keywords = "At most 50 keywords (API limit)";
    if (!form.prompt.trim()) e.prompt = "The generation prompt is required";
    if (!editing) {
      if (!/^https?:\/\/.+/.test(form.image_link.trim())) e.image_link = 'Must be an http(s) URL like "https://…/image.png"';
    }
    if (!editing && !form.ratio) e.ratio = "Required";
    if (!editing && !form.quality) e.quality = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    const keywords = parseKeywords(form.keywords);
    try {
      if (editing && image) {
        await api.images.update(image._id, {
          ...(form.session_id !== image.session_id ? { session_id: form.session_id } : {}),
          title: form.title.trim(),
          category: form.category,
          keywords,
          prompt: form.prompt.trim(),
          ...(form.image_link.trim() !== image.image_link ? { image_link: form.image_link.trim() } : {}),
          ratio: form.ratio,
          quality: form.quality,
          used_in_adobe_stock: form.used_in_adobe_stock,
        });
        toast({ title: "Image updated", description: form.title.trim() });
      } else {
        await api.images.create({
          session_id: form.session_id,
          title: form.title.trim(),
          category: form.category,
          keywords,
          prompt: form.prompt.trim(),
          image_link: form.image_link.trim(),
          ratio: form.ratio,
          quality: form.quality,
          used_in_adobe_stock: form.used_in_adobe_stock,
        });
        toast({ title: "Image added", description: form.title.trim() });
      }
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
              ? "Fix metadata or move the image to another session."
              : "Register a generated image with its upload info."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="img-title" className="eyebrow">Title</Label>
            <Input
              id="img-title"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              className={inputCls}
              placeholder="Minimal ceramic cups on linen, top view"
              maxLength={200}
            />
            {err("title")}
          </div>

          <div>
            <Label className="eyebrow">Category</Label>
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

          <div className="sm:col-span-2">
            <Label htmlFor="img-keywords" className="eyebrow">
              Keywords — comma separated ({parseKeywords(form.keywords).length}/50)
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
                {QUALITIES.map((q) => (
                  <SelectItem key={q} value={q}>{q}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {err("quality")}
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 sm:col-span-2" htmlFor="img-used">
            <Checkbox
              id="img-used"
              checked={form.used_in_adobe_stock}
              onCheckedChange={(c) => set("used_in_adobe_stock", c === true)}
            />
            <span className="text-sm">Used — already published / consumed somewhere</span>
          </label>
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
