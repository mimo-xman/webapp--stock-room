"use client";

/** Create-session dialog — just a unique title. */

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
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface SessionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function SessionFormDialog({ open, onOpenChange, onSaved }: SessionFormDialogProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset when the dialog opens (adjust-state-during-render pattern).
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setTitle("");
      setError("");
    }
  }

  async function save() {
    const t = title.trim();
    if (t.length < 3) {
      setError("At least 3 characters");
      return;
    }
    if (t.length > 120) {
      setError("At most 120 characters");
      return;
    }
    setSaving(true);
    try {
      await api.sessions.create(t);
      toast({ title: "Session created", description: t });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.status === 409 ? "This title already exists — titles must be unique" : apiErr?.payload?.message || "Could not create the session");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none border-ink bg-surface p-0 shadow-[var(--shadow-hard)] sm:max-w-md">
        <DialogHeader className="border-b border-line p-4">
          <DialogTitle className="font-display text-lg font-bold uppercase tracking-wide">New session</DialogTitle>
          <DialogDescription className="text-sm text-ink-muted">
            A session groups one agent production run. Its title must be unique.
          </DialogDescription>
        </DialogHeader>

        <div className="p-4">
          <Label htmlFor="session-title" className="eyebrow">Title</Label>
          <Input
            id="session-title"
            value={title}
            autoFocus
            onChange={(e) => {
              setTitle(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="h-9 rounded-none border-line-strong"
            placeholder="Adobe Stock batch — ceramic still life — 2026-09-03"
            maxLength={120}
          />
          {error && (
            <p className="mt-1 text-xs text-danger" role="alert">
              {error}
            </p>
          )}
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
            {saving ? "Creating…" : "Create session"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
