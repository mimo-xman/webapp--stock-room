"use client";

/**
 * Agent prompt generator — the /prompt page's engine.
 *
 * Replaces the manual "copy AGENT_PROMPT.md, fill the [BRACKETED VARIABLES]
 * by hand" flow: the page validates every variable, renders the template
 * (everything below the ✂ CUT line of AGENT_PROMPT.md) and lets the owner
 * copy or download the final prompt as a .md file.
 *
 * The template is fetched LIVE from the public repo on GitHub (always in
 * sync with AGENT_PROMPT.md), with a bundled fallback for offline use —
 * see lib/agent-prompt-template.ts.
 */

import { BUNDLED_AGENT_PROMPT_TEMPLATE } from "./agent-prompt-template";

export const TEMPLATE_SOURCE_URL =
  "https://raw.githubusercontent.com/mimo-xman/adobe-stock-images-generator-by-agents/main/AGENT_PROMPT.md";

/** The line in AGENT_PROMPT.md that separates the owner notes from the prompt. */
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
}

export const PROMPT_VARS: PromptVar[] = [
  {
    key: "numberOfPrompts",
    token: "[NUMBER OF PROMPTS TO CREATE]",
    label: "Number of prompts to create",
    help: "How many images the agent must generate and register in this run (1–200).",
    placeholder: "10",
    type: "number",
    required: true,
  },
  {
    key: "imageApiUrl",
    token: "[ZAZO GPT IMAGE 2 API LINK]",
    label: "Image API — base URL",
    help: "The image generation API (Render), without trailing slash.",
    placeholder: "https://zazogptimage2api.onrender.com",
    type: "url",
    required: true,
  },
  {
    key: "imageApiKey",
    token: "[ZAZO GPT IMAGE 2 API KEY]",
    label: "Image API — API key",
    help: "Its key, sent as the X-API-Key header.",
    placeholder: "ZL5a…",
    type: "secret",
    required: true,
  },
  {
    key: "assetApiUrl",
    token: "[ADOBE STOCK IMAGES GENERATOR BY AGENTS API LINK]",
    label: "Asset database API — base URL",
    help: "This project's API (Render), without trailing slash.",
    placeholder: "https://adobe-stock-api.onrender.com",
    type: "url",
    required: true,
  },
  {
    key: "assetApiKey",
    token: "[ADOBE STOCK IMAGES GENERATOR BY AGENTS API KEY]",
    label: "Asset database API — API key",
    help: "Its key, sent as the X-API-Key header.",
    placeholder: "9f2b…",
    type: "secret",
    required: true,
  },
  {
    key: "imageRepoUrl",
    token: "[ZAZO GPT IMAGE 2 REPO LINK]",
    label: "Image API — backup repo link",
    help: "Given to the agent when the APIs misbehave (clone + read README).",
    placeholder: "https://github.com/mimo-xman/nodejs--api-for-gpt-image-2",
    type: "url",
    required: true,
  },
  {
    key: "assetRepoUrl",
    token: "[ADOBE STOCK IMAGES GENERATOR BY AGENTS REPO LINK]",
    label: "Asset database API — backup repo link",
    help: "Given to the agent when the APIs misbehave (clone + read README).",
    placeholder: "https://github.com/mimo-xman/adobe-stock-images-generator-by-agents",
    type: "url",
    required: true,
  },
];

export type PromptValues = Record<string, string>;

export const EMPTY_VALUES: PromptValues = Object.fromEntries(
  PROMPT_VARS.map((v) => [v.key, ""])
);

export type TemplateSource = "live" | "bundled";

export interface LoadedTemplate {
  template: string;
  source: TemplateSource;
  error?: string;
}

/** Extract the below-cut part of an AGENT_PROMPT.md document. */
export function extractTemplate(markdown: string): string | null {
  const lines = markdown.split("\n");
  const cut = lines.findIndex((line) => line.includes(CUT_MARKER));
  if (cut === -1) return null;
  const template = lines.slice(cut + 1).join("\n").trim() + "\n";
  return template.length > 200 ? template : null;
}

/** Fetch the live template from GitHub; fall back to the bundled copy. */
export async function loadTemplate(): Promise<LoadedTemplate> {
  try {
    const res = await fetch(TEMPLATE_SOURCE_URL, { cache: "no-store" });
    if (res.ok) {
      const extracted = extractTemplate(await res.text());
      if (extracted) return { template: extracted, source: "live" };
      return {
        template: BUNDLED_AGENT_PROMPT_TEMPLATE,
        source: "bundled",
        error: "live AGENT_PROMPT.md has no CUT line — used the bundled copy",
      };
    }
    return {
      template: BUNDLED_AGENT_PROMPT_TEMPLATE,
      source: "bundled",
      error: `GitHub answered HTTP ${res.status}`,
    };
  } catch {
    return {
      template: BUNDLED_AGENT_PROMPT_TEMPLATE,
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
  if (/\s/.test(value)) return "No spaces allowed inside this value.";
  if (v.type === "number") {
    if (!/^\d+$/.test(value)) return "Must be a whole number.";
    const n = Number(value);
    if (n < 1 || n > 200) return "Must be between 1 and 200.";
  }
  if (v.type === "url" && !isHttpUrl(value)) return "Must be an absolute http(s) URL.";
  if (v.type === "secret" && value.length < 8) return "That looks too short for an API key (min 8 chars).";
  return null;
}

/** Validate every variable → per-key errors (empty object = all good). */
export function validateAll(values: PromptValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const v of PROMPT_VARS) {
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
export function renderTemplate(template: string, values: PromptValues): RenderResult {
  let prompt = template;
  let replacedCount = 0;
  for (const v of PROMPT_VARS) {
    const value = (values[v.key] ?? "").trim();
    if (!value) continue;
    if (prompt.includes(v.token)) {
      prompt = prompt.split(v.token).join(value);
      replacedCount += 1;
    }
  }
  return { prompt, replacedCount };
}

/** Leftover [BRACKETED] tokens after rendering — template/template drift. */
export function findUnreplacedTokens(prompt: string): string[] {
  const found = new Set<string>();
  for (const match of prompt.matchAll(/\[[A-Z][A-Z0-9 ./-]{2,}\]/g)) {
    found.add(match[0]);
  }
  return [...found];
}

export function downloadPromptFile(prompt: string, values: PromptValues): string {
  const n = (values.numberOfPrompts || "images").trim();
  const date = new Date().toISOString().slice(0, 10);
  const filename = `agent-prompt-${n}-images-${date}.md`;
  const blob = new Blob([prompt], { type: "text/markdown;charset=utf-8" });
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

const STORAGE_KEY = "agent-prompt-values";

export function loadSavedValues(): PromptValues | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    // keep only known keys — a template change never breaks the form
    const values: PromptValues = { ...EMPTY_VALUES };
    for (const v of PROMPT_VARS) {
      if (typeof parsed[v.key] === "string") values[v.key] = parsed[v.key];
    }
    return values;
  } catch {
    return null;
  }
}

export function saveValues(values: PromptValues): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    /* private mode / quota — ignore */
  }
}

export function clearSavedValues(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
