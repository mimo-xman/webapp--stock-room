"use client";

/**
 * Agent prompt generator — fills the [BRACKETED VARIABLES] of AGENT_PROMPT.md
 * from a form, validates everything, then lets the owner copy the final
 * prompt or download it as a .md file (instead of copying the repo file and
 * replacing the variables by hand).
 *
 * The template is loaded LIVE from GitHub (public repo, CORS-open) with a
 * bundled fallback. Values persist in localStorage — including the API keys,
 * same as the app password (the owner's own browser).
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { TopBar } from "@/components/app/TopBar";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  EMPTY_VALUES,
  PROMPT_VARS,
  type PromptValues,
  type TemplateSource,
  clearSavedValues,
  downloadPromptFile,
  findUnreplacedTokens,
  loadSavedValues,
  loadTemplate,
  renderTemplate,
  saveValues,
  validateAll,
} from "@/lib/agent-prompt";

export default function AgentPromptPage() {
  const { toast } = useToast();

  const [values, setValues] = useState<PromptValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [prompt, setPrompt] = useState<string | null>(null);
  const [templateSource, setTemplateSource] = useState<TemplateSource | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(true);
  const [hasSaved, setHasSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const saved = loadSavedValues();
    if (saved) {
      setValues(saved);
      setHasSaved(true);
    }
    void refreshTemplate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshTemplate = useCallback(async () => {
    setLoadingTemplate(true);
    const loaded = await loadTemplate();
    setTemplateSource(loaded.source);
    setTemplateError(loaded.error ?? null);
    setLoadingTemplate(false);
  }, []);

  function set(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (prompt) setPrompt(null); // values changed → prompt is stale
  }

  function generate() {
    const found = validateAll(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast({
        variant: "destructive",
        title: "Some values are invalid",
        description: `${Object.keys(found).length} field(s) need attention before the prompt can be generated.`,
      });
      return;
    }
    if (loadingTemplate || templateSource === null) {
      toast({
        variant: "destructive",
        title: "Template not loaded yet",
        description: "The prompt template is still loading — try again in a second.",
      });
      return;
    }
    void (async () => {
      const loaded = await loadTemplate();
      const { prompt: rendered } = renderTemplate(loaded.template, values);
      setTemplateSource(loaded.source);
      setTemplateError(loaded.error ?? null);
      setPrompt(rendered);
      saveValues(values);
      setHasSaved(true);
      toast({
        title: "Prompt generated",
        description: "Every variable was replaced — copy it or download the .md file.",
      });
    })();
  }

  async function copyPrompt() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
      toast({ title: "Copied", description: "The full agent prompt is in your clipboard." });
    } catch {
      toast({
        variant: "destructive",
        title: "Copy failed",
        description: "Your browser blocked the clipboard — use the download button instead.",
      });
    }
  }

  function download() {
    if (!prompt) return;
    const filename = downloadPromptFile(prompt, values);
    toast({ title: "Downloaded", description: `${filename} saved to your downloads.` });
  }

  function clearSaved() {
    clearSavedValues();
    setHasSaved(false);
    toast({
      title: "Saved values cleared",
      description: "The form values (incl. API keys) were removed from this browser.",
    });
  }

  const unreplaced = prompt ? findUnreplacedTokens(prompt) : [];
  const filledCount = PROMPT_VARS.filter((v) => (values[v.key] ?? "").trim()).length;

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-tight">Agent prompt</h1>
          <p className="font-mono text-xs text-ink-muted">
            fill the variables once → validate → copy or download the ready-to-send prompt
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(320px,430px)_minmax(0,1fr)]">
          {/* ── form column ── */}
          <section className="space-y-4 border border-line-strong bg-surface p-4 shadow-[var(--shadow-hard-sm)]">
            <div className="flex items-center justify-between gap-2">
              <h2 className="eyebrow">Variables ({filledCount}/{PROMPT_VARS.length})</h2>
              {hasSaved && (
                <button
                  type="button"
                  onClick={clearSaved}
                  className="flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-wider text-ink-muted transition-colors hover:text-danger focus-visible:outline-2 focus-visible:outline-brand"
                  aria-label="Clear the values saved in this browser"
                  title="Clear the values saved in this browser (incl. API keys)"
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                  clear saved
                </button>
              )}
            </div>

            {PROMPT_VARS.map((v) => (
              <div key={v.key} className="space-y-1">
                <label
                  htmlFor={`var-${v.key}`}
                  className="flex items-baseline justify-between gap-2 text-sm font-semibold text-ink"
                >
                  <span>
                    {v.label}
                    <span className="ml-1 font-mono text-[10px] uppercase text-danger">*</span>
                  </span>
                  <span className="font-mono text-[10px] text-ink-muted">{v.type}</span>
                </label>
                <div className="relative">
                  <input
                    id={`var-${v.key}`}
                    type={v.type === "secret" && !revealed[v.key] ? "password" : v.type === "number" ? "number" : "text"}
                    inputMode={v.type === "number" ? "numeric" : undefined}
                    value={values[v.key] ?? ""}
                    placeholder={v.placeholder}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => set(v.key, e.target.value)}
                    aria-invalid={Boolean(errors[v.key])}
                    className={cn(
                      "w-full border bg-paper px-3 py-2 font-mono text-[13px] text-ink transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                      errors[v.key] ? "border-danger" : "border-line-strong hover:border-ink focus:border-ink",
                      v.type === "secret" && "pr-10"
                    )}
                  />
                  {v.type === "secret" && (
                    <button
                      type="button"
                      onClick={() => setRevealed((r) => ({ ...r, [v.key]: !r[v.key] }))}
                      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
                      aria-label={revealed[v.key] ? "Hide this API key" : "Show this API key"}
                    >
                      {revealed[v.key] ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                    </button>
                  )}
                </div>
                {errors[v.key] ? (
                  <p className="flex items-center gap-1 font-mono text-[11px] text-danger" role="alert">
                    <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                    {errors[v.key]}
                  </p>
                ) : (
                  <p className="font-mono text-[11px] leading-snug text-ink-muted">{v.help}</p>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={generate}
              className="flex h-11 w-full items-center justify-center gap-2 bg-brand font-display text-sm font-bold uppercase tracking-widest text-white shadow-[var(--shadow-hard-sm)] transition-colors hover:bg-brand-deep focus-visible:outline-2 focus-visible:outline-brand"
              data-testid="generate-prompt"
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              Generate prompt
            </button>

            <p className="border border-line bg-paper p-2.5 font-mono text-[10.5px] leading-relaxed text-ink-muted">
              After generating, the values — including the API keys — are saved in this
              browser only (localStorage), like the app password. Use “clear saved” to wipe them.
            </p>
          </section>

          {/* ── result column ── */}
          <section className="flex min-h-[420px] flex-col border border-line-strong bg-surface shadow-[var(--shadow-hard-sm)]">
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper p-3">
              <h2 className="eyebrow mr-auto flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" aria-hidden />
                Generated prompt
              </h2>

              <span
                className={cn(
                  "chip",
                  templateSource === "live"
                    ? "border-brand/60 text-brand"
                    : templateSource === "bundled"
                      ? "border-danger/60 text-danger"
                      : "border-line-strong text-ink-muted"
                )}
                title={
                  templateSource === "live"
                    ? `Template fetched live from GitHub main — always in sync with AGENT_PROMPT.md${templateError ? ` (note: ${templateError})` : ""}`
                    : templateError || "Loading template…"
                }
              >
                {loadingTemplate
                  ? "loading template…"
                  : templateSource === "live"
                    ? "template · GitHub live"
                    : templateSource === "bundled"
                      ? "template · bundled fallback"
                      : "template · not loaded"}
              </span>

              <button
                type="button"
                onClick={() => void refreshTemplate()}
                disabled={loadingTemplate}
                className="flex h-7 w-7 items-center justify-center border border-line-strong bg-surface text-ink-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-brand"
                aria-label="Re-fetch the template from GitHub"
                title="Re-fetch the template from GitHub"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loadingTemplate && "animate-spin")} aria-hidden />
              </button>

              {prompt && (
                <>
                  <button
                    type="button"
                    onClick={copyPrompt}
                    className={cn(
                      "flex h-[34px] items-center gap-2 border-2 px-3 font-display text-xs font-bold uppercase tracking-widest transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                      copied
                        ? "border-stamp bg-stamp-soft text-stamp"
                        : "border-line-strong bg-surface text-ink hover:border-ink"
                    )}
                    data-testid="copy-prompt"
                  >
                    {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    onClick={download}
                    className="flex h-[34px] items-center gap-2 bg-brand px-3.5 font-display text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-brand-deep focus-visible:outline-2 focus-visible:outline-brand"
                    data-testid="download-prompt"
                  >
                    <Download className="h-4 w-4" aria-hidden />
                    Download .md
                  </button>
                </>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              {prompt === null ? (
                <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 p-6 text-center text-ink-muted">
                  <Sparkles className="h-8 w-8" aria-hidden />
                  <p className="max-w-sm font-mono text-xs leading-relaxed">
                    Fill every variable on the left and click <strong className="text-ink">Generate prompt</strong>.
                    The result — everything below the ✂ CUT line of AGENT_PROMPT.md with your
                    values in place — appears here, ready to copy or download.
                  </p>
                </div>
              ) : (
                <>
                  {unreplaced.length > 0 && (
                    <p
                      className="mb-3 flex flex-wrap items-start gap-2 border border-danger bg-danger-soft p-2.5 font-mono text-[11px] leading-relaxed text-danger"
                      role="alert"
                    >
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>
                        The template contains variables this form does not know:{" "}
                        {unreplaced.map((t) => (
                          <code key={t} className="border border-danger/30 bg-surface px-1">
                            {t}
                          </code>
                        ))}
                        — fill them by hand after copying (the template evolved).
                      </span>
                    </p>
                  )}
                  <pre
                    className="whitespace-pre-wrap break-words border border-line bg-paper p-3 font-mono text-[11.5px] leading-relaxed text-ink"
                    data-testid="generated-prompt"
                  >
                    {prompt}
                  </pre>
                </>
              )}
            </div>

            {prompt !== null && (
              <p className="border-t border-line bg-paper p-2.5 font-mono text-[10.5px] text-ink-muted">
                {prompt.length.toLocaleString()} characters · LYRA section included verbatim · send it
                as ONE message to your AI agent
              </p>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
