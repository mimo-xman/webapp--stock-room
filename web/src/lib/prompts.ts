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
 *
 * GLOBAL CONTENT RULES — the owner's absolute image ban (no living beings, no
 * faces, no body parts, even on objects) must reach the agent in EVERY
 * prompt, present and future. Every template embeds the canonical block
 * (scripts/gen-prompt-template.py refuses to bundle a prompt without it) and
 * renderTemplate() appends it as a final safety net to any rendered prompt
 * whose template somehow lost it.
 *
 * GLOBAL DISTINCTIVENESS RULES — the anti-similarity doctrine (every image
 * clearly differentiated from the platform's existing content AND from the
 * rest of the batch; never the default depiction; saturation checked before
 * committing to a subject; distinctiveness verified before saving) gets the
 * exact same treatment: embedded in every template (the generator script
 * refuses to bundle a prompt without it) and appended here as a safety net.
 * This is the definitive fix for Adobe Stock's similar-content rejection —
 * it applies to every prompt, present and future.
 */

import { BUNDLED_TEMPLATE_MAIN } from "./prompt-templates/main";
import { BUNDLED_TEMPLATE_STOCK_PLATFORMS } from "./prompt-templates/stock-platforms";
import { BUNDLED_TEMPLATE_COLORING_BOOK_ETSY } from "./prompt-templates/coloring-book-etsy";
import { BUNDLED_TEMPLATE_ACTIVITY_BOOK_ETSY } from "./prompt-templates/activity-book-etsy";
import { BUNDLED_TEMPLATE_PARTY_INVITATIONS_ETSY } from "./prompt-templates/party-invitations-etsy";
import { BUNDLED_TEMPLATE_WALL_ART_SET_ETSY } from "./prompt-templates/wall-art-set-etsy";
import { BUNDLED_TEMPLATE_PRINTABLE_SET_ETSY } from "./prompt-templates/printable-set-etsy";
import { BUNDLED_TEMPLATE_CLIPART_BUNDLE_ETSY } from "./prompt-templates/clipart-bundle-etsy";
import { BUNDLED_TEMPLATE_DIGITAL_DOWNLOAD_ETSY } from "./prompt-templates/digital-download-etsy";
import { GLOBAL_CONTENT_RULES } from "./prompt-templates/global-content-rules";
import { GLOBAL_DISTINCTIVENESS_RULES } from "./prompt-templates/global-distinctiveness-rules";

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
  icon: "sparkles" | "store" | "book" | "puzzle" | "mail" | "frame" | "clipboard" | "shapes" | "download";
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
    id: "stock-platforms",
    title: "Stock platforms — all marketplaces",
    tagline: "Sell-ready batch for EVERY marketplace (Adobe Stock, Shutterstock, Wirestock, iStock, Pond5, Depositphotos, 123RF, Dreamstime): rules + saturation research, differentiation profiles, per-platform upload metadata.",
    purpose: "stock marketplaces",
    icon: "store",
    file: "prompts/stock-platforms.md",
    bundled: BUNDLED_TEMPLATE_STOCK_PLATFORMS,
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
    tagline: "Children's line-art coloring pages + cover + the book's ANNOUNCEMENT images (the Etsy listing photos that sell it) — the agent researches Etsy demand and picks a NON-LIVING theme itself (the owner's content rules: no living beings, no faces, no body parts).",
    purpose: "etsy",
    icon: "book",
    file: "prompts/coloring-book-etsy.md",
    bundled: BUNDLED_TEMPLATE_COLORING_BOOK_ETSY,
    specificVars: [
      {
        key: "numberOfPages",
        token: "[NUMBER OF COLORING PAGES]",
        label: "Number of coloring pages",
        help: "How many coloring pages to produce (cover is extra, always 1; the announcement images are extra too — the agent generates at least 4 of them automatically). The theme is NOT typed here — the agent researches Etsy's current demand and picks it itself, always a NON-LIVING theme (no animals, no people, no characters: the owner's global content rules).",
        placeholder: "20",
        type: "number",
        required: true,
      },
    ],
  },
  {
    id: "activity-book-etsy",
    title: "Activity book — Etsy",
    tagline: "Children's line-art activity pages (mazes, dot-to-dot, tracing, matching…) + cover + ANNOUNCEMENT images — mixed activity types, solvable puzzles, the agent researches Etsy demand and picks a NON-LIVING theme itself.",
    purpose: "etsy",
    icon: "puzzle",
    file: "prompts/activity-book-etsy.md",
    bundled: BUNDLED_TEMPLATE_ACTIVITY_BOOK_ETSY,
    specificVars: [
      {
        key: "numberOfPages",
        token: "[NUMBER OF ACTIVITY PAGES]",
        label: "Number of activity pages",
        help: "How many activity pages to produce (cover is extra, always 1; the announcement images are extra too — at least 4). The theme is NOT typed here — the agent researches Etsy's current demand and picks it itself, always a NON-LIVING theme, with at least four different activity types across the book.",
        placeholder: "20",
        type: "number",
        required: true,
      },
    ],
  },
  {
    id: "party-invitations-etsy",
    title: "Party invitations — Etsy",
    tagline: "A cohesive set of fill-in 5×7 invitation designs + ANNOUNCEMENT images — the agent researches the occasion + theme (birthdays, showers…) and picks them itself, always NON-LIVING decorations.",
    purpose: "etsy",
    icon: "mail",
    file: "prompts/party-invitations-etsy.md",
    bundled: BUNDLED_TEMPLATE_PARTY_INVITATIONS_ETSY,
    specificVars: [
      {
        key: "numberOfDesigns",
        token: "[NUMBER OF INVITATION DESIGNS]",
        label: "Number of invitation designs",
        help: "How many card designs the set contains (each prints at 5×7 in; the announcement images are extra — at least 4). The occasion and theme are NOT typed here — the agent researches Etsy's current demand and picks them itself, always a NON-LIVING theme (balloons, vehicles, stars, flowers…).",
        placeholder: "4",
        type: "number",
        required: true,
      },
    ],
  },
  {
    id: "wall-art-set-etsy",
    title: "Wall art set — Etsy",
    tagline: "A cohesive gallery of matching printable art prints + ANNOUNCEMENT images (styled frames, gallery-wall mockups built from the real prints) — the agent researches the style + theme and picks them itself, always NON-LIVING.",
    purpose: "etsy",
    icon: "frame",
    file: "prompts/wall-art-set-etsy.md",
    bundled: BUNDLED_TEMPLATE_WALL_ART_SET_ETSY,
    specificVars: [
      {
        key: "numberOfPrints",
        token: "[NUMBER OF ART PRINTS]",
        label: "Number of art prints",
        help: "How many matching prints the set contains (each prints at 8×10 in / A4 or larger; the announcement images are extra — at least 4). The style + theme are NOT typed here — the agent researches Etsy's current demand and picks them itself, always a NON-LIVING theme (botanicals, abstracts, landscapes, typography…).",
        placeholder: "6",
        type: "number",
        required: true,
      },
    ],
  },
  {
    id: "printable-set-etsy",
    title: "Printable set — Etsy",
    tagline: "A functional printable system (chore charts, planners, trackers, bingo, gift tags…) + ANNOUNCEMENT images — usable layouts, perfect spelling, the agent researches the niche and designs the set itself, decorated with NON-LIVING accents only.",
    purpose: "etsy",
    icon: "clipboard",
    file: "prompts/printable-set-etsy.md",
    bundled: BUNDLED_TEMPLATE_PRINTABLE_SET_ETSY,
    specificVars: [
      {
        key: "numberOfPages",
        token: "[NUMBER OF PRINTABLE PAGES]",
        label: "Number of printable pages",
        help: "How many coordinated pages the set contains (each prints at US Letter 8.5×11 in; the announcement images are extra — at least 4). The niche is NOT typed here — the agent researches Etsy's current demand and picks the whole system itself, decorated with NON-LIVING accents only.",
        placeholder: "10",
        type: "number",
        required: true,
      },
    ],
  },
  {
    id: "clipart-bundle-etsy",
    title: "Clipart bundle — Etsy",
    tagline: "A themed bundle of individual PNG clipart elements (isolated on pure white, one consistent style) + ANNOUNCEMENT sample sheets built from the real elements — the agent researches the theme + style and picks them itself, always NON-LIVING.",
    purpose: "etsy",
    icon: "shapes",
    file: "prompts/clipart-bundle-etsy.md",
    bundled: BUNDLED_TEMPLATE_CLIPART_BUNDLE_ETSY,
    specificVars: [
      {
        key: "numberOfElements",
        token: "[NUMBER OF CLIPART ELEMENTS]",
        label: "Number of clipart elements",
        help: "How many individual PNG elements the bundle contains (each is one isolated element; the announcement images are extra — at least 4). The theme + style are NOT typed here — the agent researches Etsy's current demand and picks them itself, always a NON-LIVING theme (flowers, vehicles, objects, symbols…).",
        placeholder: "30",
        type: "number",
        required: true,
      },
    ],
  },
  {
    id: "digital-download-etsy",
    title: "Digital download — Etsy (any product)",
    tagline: "The generic Etsy prompt: the agent researches what digital product sells right now, picks the product AND its product_type itself (templates, games, educational resources, cards, seasonal sets…), then applies the matching conventions — always NON-LIVING.",
    purpose: "etsy",
    icon: "download",
    file: "prompts/digital-download-etsy.md",
    bundled: BUNDLED_TEMPLATE_DIGITAL_DOWNLOAD_ETSY,
    specificVars: [
      {
        key: "numberOfImages",
        token: "[NUMBER OF PRODUCT IMAGES]",
        label: "Number of product images",
        help: "How many images make up the deliverable (the hero image + the other pieces; the announcement images are extra — at least 4). The product idea and its type are NOT typed here — the agent researches Etsy's current demand and picks them itself, always a NON-LIVING theme.",
        placeholder: "12",
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

/** Marker proving a template already embeds the owner's global content rules. */
const CONTENT_RULES_MARKER = "NO LIVING BEINGS";

/** Marker proving a template already embeds the global distinctiveness rules. */
const DISTINCTIVENESS_MARKER = "CLEARLY DIFFERENTIATED";

/**
 * Safety net — the owner's absolute image ban (no living beings, no faces, no
 * body parts, even on objects) must be inside EVERY prompt sent to an agent.
 * The templates embed the canonical block (see prompts/_global-content-rules.md
 * and scripts/gen-prompt-template.py); if a template — live or bundled, today
 * or in the future — somehow lost it, append the block to the rendered prompt.
 */
function withGlobalContentRules(rendered: string): string {
  if (rendered.includes(CONTENT_RULES_MARKER)) return rendered;
  return `${rendered.trimEnd()}\n\n---\n\n${GLOBAL_CONTENT_RULES.trim()}\n`;
}

/**
 * Safety net #2 — the GLOBAL DISTINCTIVENESS RULES (anti-similarity: stand out
 * from the platform's existing content and from the rest of the batch, never
 * the default depiction, saturation checked, distinctiveness verified) must
 * also be inside EVERY prompt sent to an agent. Stock platforms (Adobe Stock
 * first) hard-refuse similar content — an agent prompt without these rules
 * produces lookalikes that die in review. The templates embed the canonical
 * block (see prompts/_global-distinctiveness-rules.md and
 * scripts/gen-prompt-template.py, which refuses to bundle a prompt without
 * it); if a template — live or bundled, today or in the future — somehow lost
 * it, append the block to the rendered prompt.
 */
function withGlobalDistinctivenessRules(rendered: string): string {
  if (rendered.includes(DISTINCTIVENESS_MARKER)) return rendered;
  return `${rendered.trimEnd()}\n\n---\n\n${GLOBAL_DISTINCTIVENESS_RULES.trim()}\n`;
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
  return { prompt: withGlobalDistinctivenessRules(withGlobalContentRules(rendered)), replacedCount };
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
