"use client";

/**
 * Agent prompts generator — pick a mission prompt (main / stock platforms /
 * coloring book…), fill the shared connection variables once, add the
 * mission-specific variable, validate, then copy or download the
 * ready-to-send prompt as a .md file.
 *
 * Templates load LIVE from GitHub (public repo, CORS-open) with a bundled
 * fallback per prompt. Shared values persist in localStorage across prompts —
 * including the API keys, same as the app password (the owner's own browser).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ClipboardList,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  Frame,
  Mail,
  Plug,
  Puzzle,
  RefreshCw,
  Server,
  Shapes,
  ShieldCheck,
  Sparkles,
  Store,
  Target,
  Trash2,
} from "lucide-react";
import { TopBar } from "@/components/app/TopBar";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  EMPTY_SHARED_VALUES,
  PROMPTS,
  type PromptDefinition,
  type PromptValues,
  type TemplateSource,
  clearAllSavedValues,
  downloadPromptFile,
  findUnreplacedTokens,
  getPrompt,
  hasAnySavedValues,
  loadSharedValues,
  loadSpecificValues,
  loadTemplate,
  promptVars,
  renderTemplate,
  saveSharedValues,
  saveSpecificValues,
  validateAll,
} from "@/lib/prompts";

const SELECTED_KEY = "prompt-selected";

const ICONS = {
  sparkles: Sparkles,
  store: Store,
  book: BookOpen,
  puzzle: Puzzle,
  mail: Mail,
  frame: Frame,
  server: Server,
  clipboard: ClipboardList,
  shapes: Shapes,
  download: Download,
} as const;

export default function AgentPromptPage() {
  const { toast } = useToast();

  const [promptId, setPromptId] = useState<string>(PROMPTS[0].id);
  const [shared, setShared] = useState<PromptValues>(EMPTY_SHARED_VALUES);
  const [specific, setSpecific] = useState<Record<string, PromptValues>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [prompt, setPrompt] = useState<string | null>(null);
  const [templateSources, setTemplateSources] = useState<Record<string, TemplateSource | null>>({});
  const [templateErrors, setTemplateErrors] = useState<Record<string, string | null>>({});
  const [loadingTemplate, setLoadingTemplate] = useState(true);
  const [hasSaved, setHasSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const selected: PromptDefinition = useMemo(
    () => getPrompt(promptId) ?? PROMPTS[0],
    [promptId]
  );
  const values: PromptValues = useMemo(
    () => ({ ...shared, ...(specific[selected.id] ?? {}) }),
    [shared, specific, selected]
  );

  const refreshTemplate = useCallback(async (p: PromptDefinition) => {
    setLoadingTemplate(true);
    const loaded = await loadTemplate(p);
    setTemplateSources((prev) => ({ ...prev, [p.id]: loaded.source }));
    setTemplateErrors((prev) => ({ ...prev, [p.id]: loaded.error ?? null }));
    setLoadingTemplate(false);
  }, []);

  useEffect(() => {
    // hydrate saved values after mount (one-time migration from the old
    // single-prompt storage happens inside loadSharedValues)
    void (async () => {
      const savedId = getPrompt(localStorage.getItem(SELECTED_KEY) ?? "")?.id;
      if (savedId) setPromptId(savedId);
      setShared(loadSharedValues());
      setSpecific(Object.fromEntries(PROMPTS.map((p) => [p.id, loadSpecificValues(p)])));
      setHasSaved(hasAnySavedValues());
      void refreshTemplate(getPrompt(savedId ?? PROMPTS[0].id) ?? PROMPTS[0]);
    })();
  }, []);

  function selectPrompt(id: string) {
    if (id === promptId || prompt !== null) {
      // switching would drop the generated result — ask the user via the chip
      if (prompt !== null) {
        toast({
          variant: "destructive",
          title: "Prompt already generated",
          description: "Copy or download it first — switching clears the result.",
        });
        return;
      }
      return;
    }
    setPromptId(id);
    setErrors({});
    try {
      localStorage.setItem(SELECTED_KEY, id);
    } catch {
      /* ignore */
    }
    const next = getPrompt(id) ?? PROMPTS[0];
    if (templateSources[id] === undefined || templateSources[id] === null) void refreshTemplate(next);
  }

  function set(key: string, value: string) {
    const isShared = key in EMPTY_SHARED_VALUES;
    if (isShared) setShared((prev) => ({ ...prev, [key]: value }));
    else setSpecific((prev) => ({ ...prev, [selected.id]: { ...(prev[selected.id] ?? {}), [key]: value } }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (prompt) setPrompt(null); // values changed → prompt is stale
  }

  function generate() {
    const found = validateAll(selected, values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast({
        variant: "destructive",
        title: "Some values are invalid",
        description: `${Object.keys(found).length} field(s) need attention before the prompt can be generated.`,
      });
      return;
    }
    void (async () => {
      const loaded = await loadTemplate(selected);
      setTemplateSources((prev) => ({ ...prev, [selected.id]: loaded.source }));
      setTemplateErrors((prev) => ({ ...prev, [selected.id]: loaded.error ?? null }));
      const { prompt: rendered } = renderTemplate(selected, loaded.template, values);
      setPrompt(rendered);
      saveSharedValues(shared);
      saveSpecificValues(selected, specific[selected.id] ?? {});
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
    const filename = downloadPromptFile(prompt, selected);
    toast({ title: "Downloaded", description: `${filename} saved to your downloads.` });
  }

  function clearSaved() {
    clearAllSavedValues();
    setShared(EMPTY_SHARED_VALUES);
    setSpecific({});
    setHasSaved(false);
    toast({
      title: "Saved values cleared",
      description: "The connection values (incl. API keys) were removed from this browser.",
    });
  }

  const unreplaced = prompt ? findUnreplacedTokens(prompt) : [];
  const vars = promptVars(selected);
  const filledCount = vars.filter((v) => (values[v.key] ?? "").trim()).length;
  const templateSource = templateSources[selected.id] ?? null;
  const templateError = templateErrors[selected.id] ?? null;

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-tight">Agent prompts</h1>
          <p className="font-mono text-xs text-ink-muted">
            pick a mission → fill the variables once → validate → copy or download the ready-to-send prompt
          </p>
          <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-ink-muted">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
            every prompt embeds the owner's global content rules — no living beings, no faces,
            no body parts — and the global distinctiveness rules — clearly differentiated from
            the platform and the batch, never the default depiction — enforced at research,
            generation and visual check
          </p>
        </div>

        {/* ── prompt switcher (scalable: one card per mission type) ── */}
        <section aria-label="Prompt selection" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PROMPTS.map((p) => {
            const Icon = ICONS[p.icon];
            const active = p.id === selected.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => selectPrompt(p.id)}
                aria-pressed={active}
                className={cn(
                  "flex items-start gap-3 border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                  active
                    ? "border-brand bg-brand-soft shadow-[var(--shadow-hard-sm)]"
                    : "border-line-strong bg-surface hover:border-ink"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 -rotate-3 items-center justify-center",
                    active ? "bg-brand text-white" : "bg-paper text-ink-muted"
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="font-display text-sm font-bold uppercase tracking-wide text-ink">
                      {p.title}
                    </span>
                    <span className="chip shrink-0 border-line bg-paper lowercase">{p.purpose}</span>
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-muted">{p.tagline}</span>
                </span>
              </button>
            );
          })}
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(320px,430px)_minmax(0,1fr)]">
          {/* ── form column ── */}
          <section className="space-y-4 border border-line-strong bg-surface p-4 shadow-[var(--shadow-hard-sm)]">
            <div className="flex items-center justify-between gap-2">
              <h2 className="eyebrow">
                {selected.title} — variables ({filledCount}/{vars.length})
              </h2>
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

            {/* shared connection variables */}
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 border-b border-line pb-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink">
                <Plug className="h-3.5 w-3.5 text-brand" aria-hidden />
                Connection — shared across all prompts
              </h3>
              <div className="space-y-3 pt-2">
                {vars.map((v) =>
                  v.key in EMPTY_SHARED_VALUES ? (
                    <VarField
                      key={v.key}
                      v={v}
                      value={values[v.key] ?? ""}
                      error={errors[v.key]}
                      revealed={revealed[v.key]}
                      onReveal={() => setRevealed((r) => ({ ...r, [v.key]: !r[v.key] }))}
                      onChange={(value) => set(v.key, value)}
                    />
                  ) : null
                )}
              </div>
            </div>

            {/* mission-specific variables */}
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 border-b border-line pb-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink">
                <Target className="h-3.5 w-3.5 text-brand" aria-hidden />
                Mission — specific to this prompt
              </h3>
              <div className="space-y-3 pt-2">
                {vars.map((v) =>
                  v.key in EMPTY_SHARED_VALUES ? null : (
                    <VarField
                      key={v.key}
                      v={v}
                      value={values[v.key] ?? ""}
                      error={errors[v.key]}
                      revealed={revealed[v.key]}
                      onReveal={() => setRevealed((r) => ({ ...r, [v.key]: !r[v.key] }))}
                      onChange={(value) => set(v.key, value)}
                    />
                  )
                )}
              </div>
            </div>

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
              The connection values — including the API keys — are saved in this browser only
              (localStorage) and reused by every prompt. Use “clear saved” to wipe them.
            </p>
          </section>

          {/* ── result column ── */}
          <section className="flex min-h-[420px] flex-col border border-line-strong bg-surface shadow-[var(--shadow-hard-sm)]">
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper p-3">
              <h2 className="eyebrow mr-auto flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" aria-hidden />
                Generated prompt — {selected.title}
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
                    ? `Template fetched live from GitHub main — always in sync with ${selected.file}${templateError ? ` (note: ${templateError})` : ""}`
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
                onClick={() => void refreshTemplate(selected)}
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
                    The result — everything below the ✂ CUT line of {selected.file} with your
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

interface VarFieldProps {
  v: {
    key: string;
    label: string;
    help: string;
    placeholder: string;
    type: "number" | "url" | "secret" | "text";
    multiline?: boolean;
  };
  value: string;
  error?: string;
  revealed?: boolean;
  onReveal: () => void;
  onChange: (value: string) => void;
}

function VarField({ v, value, error, revealed, onReveal, onChange }: VarFieldProps) {
  const id = `var-${v.key}`;
  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="flex items-baseline justify-between gap-2 text-sm font-semibold text-ink"
      >
        <span>
          {v.label}
          <span className="ml-1 font-mono text-[10px] uppercase text-danger">*</span>
        </span>
        <span className="font-mono text-[10px] text-ink-muted">{v.multiline ? "text" : v.type}</span>
      </label>
      {v.multiline ? (
        <textarea
          id={id}
          rows={4}
          value={value}
          placeholder={v.placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          className={cn(
            "w-full border bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink transition-colors focus-visible:outline-2 focus-visible:outline-brand",
            error ? "border-danger" : "border-line-strong hover:border-ink focus:border-ink"
          )}
        />
      ) : (
        <div className="relative">
          <input
            id={id}
            type={v.type === "secret" && !revealed ? "password" : v.type === "number" ? "number" : "text"}
            inputMode={v.type === "number" ? "numeric" : undefined}
            value={value}
            placeholder={v.placeholder}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={Boolean(error)}
            className={cn(
              "w-full border bg-paper px-3 py-2 font-mono text-[13px] text-ink transition-colors focus-visible:outline-2 focus-visible:outline-brand",
              error ? "border-danger" : "border-line-strong hover:border-ink focus:border-ink",
              v.type === "secret" && "pr-10"
            )}
          />
          {v.type === "secret" && (
            <button
              type="button"
              onClick={onReveal}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
              aria-label={revealed ? "Hide this API key" : "Show this API key"}
            >
              {revealed ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          )}
        </div>
      )}
      {error ? (
        <p className="flex items-center gap-1 font-mono text-[11px] text-danger" role="alert">
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
          {error}
        </p>
      ) : (
        <p className="font-mono text-[11px] leading-snug text-ink-muted">{v.help}</p>
      )}
    </div>
  );
}
