"use client";

/**
 * Agent prompts registry — the /prompt page's engine.
 *
 * Stock Room is mission-agnostic: several ready-to-send agent prompts live in
 * prompts/ at the repo root (one .md per mission type), each with the same
 * layout: a variables table → a ✂ CUT HERE line → the prompt.
 *
 * Every prompt shares the six "connection" variables (the two APIs + backup
 * repo links) — filled once, kept in localStorage — plus its own
 * mission-specific variables. The page loads the selected template LIVE from
 * GitHub (public repo, CORS-open) with a bundled fallback per prompt.
 */

import { BUNDLED_TEMPLATE_MAIN } from "./prompt-templates/main";
import { BUNDLED_TEMPLATE_ADOBE_STOCK } from "./prompt-templates/adobe-stock";
import { BUNDLED_TEMPLATE_COLORING_BOOK_ETSY } from "./prompt-templates/coloring-book-etsy";

export const TEMPLATE_SOURCE_BASE =
  "https://raw.githubusercontent.com/mimo-xman/webapp--stock-room/main/prompts";

/** The line in a prompt file that separates the owner notes from the prompt. */
const CUT_MARKER = "CUT HERE";

export type PromptVarType = "number" | "url" | "secret" | "text";

export interface PromptVar {
  /** Form state key. */
  key: string;
  /** The literal token replaced in the template. */
  token: string;
  label: string;
  help: string;
  placeholder: string;
  type: PromptVarType;
  required: boolean;
  /** Free-text mission briefs may span several lines. */
  multiline?: boolean;
}

export interface PromptDefinition {
  /** Registry id — also the prompts/<id>.md filename. */
  id: string;
  title: string;
  /** One-line description shown on the switcher card. */
  tagline: string;
  /** Small chip shown on the switcher card + result header. */
  purpose: string;
  /** Icon key resolved by the page (keeps this file icon-free). */
  icon: "sparkles" | "store" | "book";
  /** prompts/<file> on GitHub raw. */
  file: string;
  bundled: string;
  /** Mission-specific variables (the shared six are appended on top). */
  specificVars: PromptVar[];
}

// ── shared connection variables (common to every prompt) ──────────────────

export const SHARED_VARS: PromptVar[] = [
  {
    key: "imageApiUrl",
    token: "[ZAZO IMAGE STUDIO API LINK]",
    label: "Zazo Image Studio API — base URL",
    help: "The image generation API (Render), without trailing slash.",
    placeholder: "https://zazo-image-studio.onrender.com",
    type: "url",
    required: true,
  },
  {
    key: "imageApiKey",
    token: "[ZAZO IMAGE STUDIO API KEY]",
    label: "Zazo Image Studio API — API key",
    help: "Its key, sent as the X-API-Key header.",
    placeholder: "ZL5a…",
    type: "secret",
    required: true,
  },
  {
    key: "assetApiUrl",
    token: "[STOCK ROOM API LINK]",
    label: "Stock Room API — base URL",
    help: "This project's API (Render), without trailing slash.",
    placeholder: "https://stock-room-api.onrender.com",
    type: "url",
    required: true,
  },
  {
    key: "assetApiKey",
    token: "[STOCK ROOM API KEY]",
    label: "Stock Room API — API key",
    help: "Its key, sent as the X-API-Key header.",
    placeholder: "9f2b…",
    type: "secret",
    required: true,
  },
  {
    key: "imageRepoUrl",
    token: "[ZAZO IMAGE STUDIO REPO LINK]",
    label: "Zazo Image Studio — backup repo link",
    help: "Given to the agent when the APIs misbehave (clone + read README).",
    placeholder: "https://github.com/mimo-xman/webapp--zazo-image-studio",
    type: "url",
    required: true,
  },
  {
    key: "assetRepoUrl",
    token: "[STOCK ROOM REPO LINK]",
    label: "Stock Room — backup repo link",
    help: "Given to the agent when the APIs misbehave (clone + read README).",
    placeholder: "https://github.com/mimo-xman/webapp--stock-room",
    type: "url",
    required: true,
  },
];

// ── the registry ───────────────────────────────────────────────────────────

export const PROMPTS: PromptDefinition[] = [
  {
    id: "main",
    title: "Main — any mission",
    tagline: "Universal prompt: you describe the mission, the agent produces the images.",
    purpose: "any platform",
    icon: "sparkles",
    file: "prompts/main.md",
    bundled: BUNDLED_TEMPLATE_MAIN,
    specificVars: [
      {
        key: "missionBrief",
        token: "[MISSION BRIEF]",
        label: "Mission brief — what the agent must do",
        help: "Free text: subject, number of images, style, destination platform, constraints…",
        placeholder: "Create 12 vertical 9:16 images for an Instagram event about sustainable coffee…",
        type: "text",
        required: true,
        multiline: true,
      },
    ],
  },
  {
    id: "adobe-stock",
    title: "Adobe Stock",
    tagline: "Sell-ready stock batch: demand research, hard rules, upload metadata.",
    purpose: "adobe stock",
    icon: "store",
    file: "prompts/adobe-stock.md",
    bundled: BUNDLED_TEMPLATE_ADOBE_STOCK,
    specificVars: [
      {
        key: "numberOfPrompts",
        token: "[NUMBER OF PROMPTS TO CREATE]",
        label: "Number of prompts to create",
        help: "How many images the agent must generate and register in this run (1–200).",
        placeholder: "10",
        type: "number",
        required: true,
      },
    ],
  },
  {
    id: "coloring-book-etsy",
    title: "Coloring book — Etsy",
    tagline: "Children's line-art coloring pages + cover, print-ready, Etsy rules.",
    purpose: "etsy",
    icon: "book",
    file: "prompts/coloring-book-etsy.md",
    bundled: BUNDLED_TEMPLATE_COLORING_BOOK_ETSY,
    specificVars: [
      {
        key: "bookTheme",
        token: "[BOOK THEME]",
        label: "Book theme",
        help: "The theme/subject of the coloring book (e.g. Ocean animals).",
        placeholder: "Ocean animals",
        type: "text",
        required: true,
      },
      {
        key: "numberOfPages",
        token: "[NUMBER OF COLORING PAGES]",
        label: "Number of coloring pages",
        help: "How many coloring pages to produce (cover is extra, always 1).",
        placeholder: "20",
        type: "number",
        required: true,
      },
    ],
  },
];

export function getPrompt(id: string): PromptDefinition | undefined {
  return PROMPTS.find((p) => p.id === id);
}

/** All variables of a prompt: shared six first, then mission-specific. */
export function promptVars(prompt: PromptDefinition): PromptVar[] {
  return [...SHARED_VARS, ...prompt.specificVars];
}

export type PromptValues = Record<string, string>;

export const EMPTY_SHARED_VALUES: PromptValues = Object.fromEntries(
  SHARED_VARS.map((v) => [v.key, ""])
);

export function emptyValues(prompt: PromptDefinition): PromptValues {
  return Object.fromEntries(promptVars(prompt).map((v) => [v.key, ""]));
}

export type TemplateSource = "live" | "bundled";

export interface LoadedTemplate {
  template: string;
  source: TemplateSource;
  error?: string;
}

/** Extract the below-cut part of a prompt file. */
export function extractTemplate(markdown: string): string | null {
  const lines = markdown.split("\n");
  const cut = lines.findIndex((line) => line.includes(CUT_MARKER));
  if (cut === -1) return null;
  const template = lines.slice(cut + 1).join("\n").trim() + "\n";
  return template.length > 200 ? template : null;
}

/** Fetch the live template from GitHub; fall back to the bundled copy. */
export async function loadTemplate(prompt: PromptDefinition): Promise<LoadedTemplate> {
  try {
    const res = await fetch(`${TEMPLATE_SOURCE_BASE}/${prompt.file}`, { cache: "no-store" });
    if (res.ok) {
      const extracted = extractTemplate(await res.text());
      if (extracted) return { template: extracted, source: "live" };
      return {
        template: prompt.bundled,
        source: "bundled",
        error: `live ${prompt.file} has no CUT line — used the bundled copy`,
      };
    }
    return {
      template: prompt.bundled,
      source: "bundled",
      error: `GitHub answered HTTP ${res.status}`,
    };
  } catch {
    return {
      template: prompt.bundled,
      source: "bundled",
      error: "GitHub unreachable",
    };
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Validate one variable → null when OK, an error message otherwise. */
export function validateVar(v: PromptVar, raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Required — the agent needs this value.";
  if (!v.multiline && /\s/.test(value)) return "No spaces allowed inside this value.";
  if (v.type === "number") {
    if (!/^\d+$/.test(value)) return "Must be a whole number.";
    const n = Number(value);
    if (n < 1 || n > 200) return "Must be between 1 and 200.";
  }
  if (v.type === "url" && !isHttpUrl(value)) return "Must be an absolute http(s) URL.";
  if (v.type === "secret" && value.length < 8) return "That looks too short for an API key (min 8 chars).";
  if (v.multiline && value.length < 10) return "Describe the mission — at least a full sentence.";
  return null;
}

/** Validate every variable of a prompt → per-key errors (empty object = all good). */
export function validateAll(prompt: PromptDefinition, values: PromptValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const v of promptVars(prompt)) {
    const err = validateVar(v, values[v.key] ?? "");
    if (err) errors[v.key] = err;
  }
  return errors;
}

export interface RenderResult {
  prompt: string;
  replacedCount: number;
}

/** Replace every variable token with its validated value. */
export function renderTemplate(prompt: PromptDefinition, template: string, values: PromptValues): RenderResult {
  let rendered = template;
  let replacedCount = 0;
  for (const v of promptVars(prompt)) {
    const value = (values[v.key] ?? "").trim();
    if (!value) continue;
    if (rendered.includes(v.token)) {
      rendered = rendered.split(v.token).join(value);
      replacedCount += 1;
    }
  }
  return { prompt: rendered, replacedCount };
}

/** Leftover [BRACKETED] tokens after rendering — template/form drift. */
export function findUnreplacedTokens(rendered: string): string[] {
  const found = new Set<string>();
  for (const match of rendered.matchAll(/\[[A-Z][A-Z0-9 ./-]{2,}\]/g)) {
    found.add(match[0]);
  }
  return [...found];
}

export function downloadPromptFile(rendered: string, prompt: PromptDefinition): string {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `agent-prompt-${prompt.id}-${date}.md`;
  const blob = new Blob([rendered], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
}

// ── persistence: shared values once + per-prompt values ────────────────────

const SHARED_STORAGE_KEY = "prompt-shared-values";
const SPECIFIC_STORAGE_PREFIX = "prompt-values-";
const LEGACY_STORAGE_KEY = "agent-prompt-values"; // pre-multi-prompt app

export function loadSharedValues(): PromptValues {
  const values: PromptValues = { ...EMPTY_SHARED_VALUES };
  const migrate = (raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return;
      for (const v of SHARED_VARS) {
        if (typeof parsed[v.key] === "string") values[v.key] = parsed[v.key];
      }
    } catch {
      /* ignore */
    }
  };
  try {
    // one-time migration from the old single-prompt storage
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy && !localStorage.getItem(SHARED_STORAGE_KEY)) migrate(legacy);
    const raw = localStorage.getItem(SHARED_STORAGE_KEY);
    if (raw) migrate(raw);
  } catch {
    /* ignore */
  }
  return values;
}

export function saveSharedValues(values: PromptValues): void {
  try {
    const slim: PromptValues = {};
    for (const v of SHARED_VARS) slim[v.key] = values[v.key] ?? "";
    localStorage.setItem(SHARED_STORAGE_KEY, JSON.stringify(slim));
  } catch {
    /* private mode / quota — ignore */
  }
}

export function loadSpecificValues(prompt: PromptDefinition): PromptValues {
  const values: PromptValues = {};
  try {
    const raw = localStorage.getItem(SPECIFIC_STORAGE_PREFIX + prompt.id);
    if (!raw) return values;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return values;
    for (const v of prompt.specificVars) {
      if (typeof parsed[v.key] === "string") values[v.key] = parsed[v.key];
    }
  } catch {
    /* ignore */
  }
  return values;
}

export function saveSpecificValues(prompt: PromptDefinition, values: PromptValues): void {
  try {
    const slim: PromptValues = {};
    for (const v of prompt.specificVars) slim[v.key] = values[v.key] ?? "";
    localStorage.setItem(SPECIFIC_STORAGE_PREFIX + prompt.id, JSON.stringify(slim));
  } catch {
    /* ignore */
  }
}

export function clearAllSavedValues(): void {
  try {
    localStorage.removeItem(SHARED_STORAGE_KEY);
    for (const p of PROMPTS) localStorage.removeItem(SPECIFIC_STORAGE_PREFIX + p.id);
  } catch {
    /* ignore */
  }
}

export function hasAnySavedValues(): boolean {
  try {
    if (localStorage.getItem(SHARED_STORAGE_KEY)) return true;
    return PROMPTS.some((p) => Boolean(localStorage.getItem(SPECIFIC_STORAGE_PREFIX + p.id)));
  } catch {
    return false;
  }
}
