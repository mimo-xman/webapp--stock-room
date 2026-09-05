"use client";

/**
 * Gate page — the password is asked on every entry to the app
 * (sessionStorage keeps it only for the current tab session).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { api, API_URL } from "@/lib/api";
import { getAppPassword, setAppPassword } from "@/lib/auth";

export default function GatePage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(() => !!getAppPassword());

  // Already signed in this tab session → go straight in.
  useEffect(() => {
    const existing = getAppPassword();
    if (!existing) return;
    api
      .verifyPassword(existing)
      .then(() => router.replace("/sessions"))
      .catch(() => setChecking(false));
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.verifyPassword(password);
      setAppPassword(password);
      router.replace("/sessions");
    } catch {
      setError("Wrong password — check the APP_PASSWORD of the API.");
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper">
        <Loader2 className="h-6 w-6 animate-spin text-ink-muted" aria-label="Loading" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-4">
      <div className="w-full max-w-sm border-2 border-ink bg-surface shadow-[var(--shadow-hard)]">
        <div className="border-b border-line p-6">
          <span className="flex h-10 w-10 -rotate-3 items-center justify-center bg-brand font-display text-base font-bold text-white shadow-[var(--shadow-hard-sm)]">
            SR
          </span>
          <h1 className="mt-4 font-display text-3xl font-bold uppercase tracking-tight">Stock Room</h1>
          <p className="mt-1 text-sm text-ink-muted">
            AI image asset dispatch — one session per mission
          </p>
        </div>

        <form onSubmit={submit} className="p-6">
          <label htmlFor="gate-password" className="eyebrow">
            App password
          </label>
          <input
            id="gate-password"
            type="password"
            value={password}
            autoFocus
            autoComplete="current-password"
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
            className="mt-1.5 h-10 w-full rounded-none border border-line-strong bg-paper px-3 font-mono text-sm text-ink focus:border-ink focus:outline-none focus:ring-0"
            placeholder="••••••••••"
          />
          {error && (
            <p className="mt-2 text-xs text-danger" role="alert">
              {error}
            </p>
          )}
          {!API_URL && (
            <p className="mt-2 font-mono text-[11px] text-danger" role="alert">
              API URL not configured — set NEXT_PUBLIC_API_URL at build time.
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !password}
            className="mt-4 flex h-10 w-full items-center justify-center gap-2 bg-brand font-display text-sm font-bold uppercase tracking-widest text-white transition-colors hover:bg-brand-deep disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
            {busy ? "Checking…" : "Enter the stock room"}
          </button>
          <p className="mt-5 font-mono text-[10px] uppercase leading-relaxed tracking-wider text-ink-muted">
            Restricted access · typed once per tab session · lock icon ends it
          </p>
        </form>
      </div>
    </main>
  );
}
