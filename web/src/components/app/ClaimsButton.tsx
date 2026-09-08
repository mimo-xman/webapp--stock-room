"use client";

/**
 * Claims badge + unlock dialog — surface the in_use reservations written by
 * the parallel upscale workers, and let the owner release them manually.
 *
 * Why: force-stopping a GitHub Actions batch (or a crashed runner) can skip
 * the worker's release call. The stuck images stay in_use:true for the whole
 * stale window (30 min by default), during which every batch skips them.
 * This badge polls GET /api/claims every 30 s and offers an immediate,
 * safe unlock (POST /api/claims/release — reservation fields only).
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Hourglass, Loader2, Unlock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { ClaimsSnapshot } from "@/lib/types";

const POLL_MS = 30_000;

/** "il y a 4 min" / "il y a 1 h 12" — locale-stable, mono-friendly. */
function ageOf(iso: string | null): string {
  if (!iso) return "?";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "?";
  const minutes = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `${h} h ${String(minutes % 60).padStart(2, "0")}`;
}

export function ClaimsButton() {
  const { toast } = useToast();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<ClaimsSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [releasing, setReleasing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.claims.list();
      setSnapshot(r.data);
    } catch {
      /* passive badge — network/auth errors stay silent (the gate
         handles 401 globally, and a failed poll is not actionable). */
    }
  }, []);

  useEffect(() => {
    // Initial fetch deferred to a macrotask: the setState lands in the
    // promise continuation, never synchronously inside this effect
    // (react-hooks/set-state-in-effect).
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);

  const total = snapshot?.total ?? 0;

  async function releaseAll() {
    setReleasing(true);
    try {
      const r = await api.claims.release("all");
      toast({
        title: "Images libérées",
        description:
          `${r.data.total} réservation${r.data.total === 1 ? "" : "s"} effacée${r.data.total === 1 ? "" : "s"} — ` +
          "les prochains workers peuvent reprendre ces images.",
      });
      setOpen(false);
      await refresh();
      router.refresh();
    } catch {
      toast({ variant: "destructive", title: "Échec de la libération", description: "Réessayez dans un instant." });
    } finally {
      setReleasing(false);
    }
  }

  if (total === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-2 border-2 border-brand bg-brand-soft px-3 font-display text-xs font-bold uppercase tracking-widest text-brand-deep transition-colors hover:bg-brand hover:text-white focus-visible:outline-2 focus-visible:outline-brand"
        title={`${total} image(s) réservée(s) par un batch worker — cliquer pour libérer`}
        aria-label={`${total} images réservées — ouvrir le panneau de libération`}
        data-testid="claims-button"
      >
        <Hourglass className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Réservées</span>
        <span className="tabular-nums">{total}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none border-ink bg-surface shadow-[var(--shadow-hard)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold uppercase tracking-wide">
              {total} image{total === 1 ? "" : "s"} réservée{total === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-ink-muted">
              Un worker d&apos;upscale a réservé ces images (in_use: true) sans les libérer —
              typiquement un workflow arrêté de force ou un runner planté. Elles redeviennent
              disponibles automatiquement après la fenêtre stale (30 min), mais vous pouvez
              les libérer maintenant. Seuls in_use / in_use_at sont effacés.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-72 overflow-y-auto border-2 border-line bg-paper">
            {snapshot && snapshot.images.length > 0 && (
              <section className="p-3">
                <h3 className="mb-2 font-display text-xs font-bold uppercase tracking-widest text-ink-muted">
                  Images à vendre · {snapshot.images.length}
                </h3>
                <ul className="space-y-1.5">
                  {snapshot.images.map((c) => (
                    <li key={c._id} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate text-ink" title={c.title}>{c.title || c._id}</span>
                      <span className="shrink-0 font-mono text-[11px] text-ink-muted">
                        il y a {ageOf(c.in_use_at)} · {c.upscales} upsc.
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {snapshot && snapshot.etsy.length > 0 && (
              <section className="border-t-2 border-line p-3">
                <h3 className="mb-2 font-display text-xs font-bold uppercase tracking-widest text-ink-muted">
                  Images de produits Etsy · {snapshot.etsy.length}
                </h3>
                <ul className="space-y-1.5">
                  {snapshot.etsy.map((c) => (
                    <li key={`${c.product_id}-${c.image_id ?? c.image_index}`} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate text-ink" title={`${c.product_title} — ${c.caption}`}>
                        {c.product_title} — {c.caption || `${c.role} #${c.image_index + 1}`}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-ink-muted">
                        il y a {ageOf(c.in_use_at)} · {c.upscales} upsc.
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <DialogFooter className="gap-2">
            <button
              type="button"
              disabled={releasing}
              onClick={() => setOpen(false)}
              className="h-9 border-2 border-ink/30 bg-surface font-display text-xs font-semibold uppercase tracking-widest text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={releasing}
              onClick={() => void releaseAll()}
              className="flex h-9 items-center gap-2 border-2 border-brand bg-brand font-display text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-brand-deep focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60"
              data-testid="claims-release"
            >
              {releasing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Unlock className="h-4 w-4" aria-hidden />}
              Tout libérer
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
