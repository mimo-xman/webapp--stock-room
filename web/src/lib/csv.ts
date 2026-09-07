/**
 * Multi-platform CSV upload export — build the contributor metadata CSV for
 * each stock marketplace from the selected images.
 *
 * DOCUMENTED FORMATS (researched from each platform's contributor docs — see
 * docs/CSV_EXPORT.md for sources):
 *
 *  Adobe Stock   : Filename,Title,Keywords,Category          (Category = 1-21 number)
 *  Shutterstock  : Filename,Description,Keywords,Categories   (1-2 categories, 26-list)
 *  Dreamstime    : Filename,Title,Description,Keywords
 *  123RF         : "oldfilename","123rf_filename","description","keywords","country" (all quoted)
 *  Pond5         : originalfilename,title,description,keywords,price (plain ASCII, no quotes)
 *
 * Wirestock, iStock and Depositphotos currently have NO public bulk-CSV
 * format → their buttons show "coming soon" (the owner will supply the
 * format later).
 *
 * For an upscaled variant the row reuses the ORIGINAL image's metadata (they
 * describe the same picture) — only the Filename differs (the variant's own
 * URL basename).
 */

import { CATEGORIES, SHUTTERSTOCK_CATEGORIES } from "./constants";
import type { PlatformId, StockImage, Upscale } from "./types";

/** One row to export: the image + optionally one specific upscale variant. */
export interface CsvSelectionItem {
  image: StockImage;
  /** When set, the row points at this upscaled variant (its URL basename
   *  becomes the Filename); metadata still comes from the original image. */
  upscale?: Upscale;
}

/** Adobe Stock category numeric codes — index + 1, exact same order as the
 *  21 official values. */
export const ADOBE_CATEGORY_IDS: Record<string, number> = Object.fromEntries(
  CATEGORIES.map((name, i) => [name, i + 1]),
);

/** Per-platform keyword caps. */
export const KEYWORD_CAPS: Partial<Record<PlatformId, number>> = {
  adobe_stock: 49,
  shutterstock: 50,
  dreamstime: 50,
  "123rf": 50,
  pond5: 50,
};

/** Platforms whose CSV export is implemented. */
export const CSV_READY_PLATFORMS: PlatformId[] = [
  "adobe_stock",
  "shutterstock",
  "dreamstime",
  "123rf",
  "pond5",
];

/** Platforms with no public CSV format yet — the picker shows "coming soon". */
export const CSV_COMING_SOON_PLATFORMS: PlatformId[] = [
  "istock",
  "wirestock",
  "depositphotos",
];

export interface CsvResult {
  /** Full CSV file content (header + rows, \r\n line endings). */
  csv: string;
  /** Number of data rows. */
  rows: number;
  /** Human-readable warnings (missing metadata, truncation…). */
  warnings: string[];
  /** Suggested download filename. */
  filename: string;
}

/** RFC 4180 field escaping: quote when the field contains a comma, a double
 *  quote or a newline; double the inner quotes. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Pond5 wants PLAIN ASCII with no quotes/special chars anywhere. */
function pond5Field(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/["']/g, "");
}

/** `https://…/folder/<image-name>.<ext>?q=1` → `<image-name>.<ext>` */
export function filenameFromUrl(url: string): string {
  const clean = url.split("?")[0].split("#")[0];
  const base = clean.substring(clean.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(base) || "image.png";
  } catch {
    return base || "image.png";
  }
}

/** Deterministic rename on Filename collisions (platforms match rows to
 *  uploaded files BY NAME — duplicates break the import). */
function dedupeFilename(filename: string, used: Map<string, number>): { name: string; renamed: boolean } {
  const seen = used.get(filename) ?? 0;
  if (seen === 0) return { name: filename, renamed: false };
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  return { name: `${stem}-${seen + 1}${ext}`, renamed: true };
}

function keywordsOf(image: StockImage, platform: PlatformId): string[] {
  const block = (image.metadata || {}) as Record<string, unknown>;
  const kw = (block[platform] as { keywords?: string[] } | undefined)?.keywords;
  if (Array.isArray(kw) && kw.length) return kw;
  // fallback: the Adobe keywords (legacy / partially-filled metadata)
  return image.keywords ?? [];
}

function clipKeywords(kws: string[], cap: number, title: string, warnings: string[]): string[] {
  if (kws.length > cap) {
    warnings.push(`"${title}": keywords truncated to ${cap} (platform limit).`);
    return kws.slice(0, cap);
  }
  return kws;
}

// ── Adobe Stock ─────────────────────────────────────────────────────────────

export function buildAdobeStockCsv(items: CsvSelectionItem[]): CsvResult {
  const warnings: string[] = [];
  const used = new Map<string, number>();
  const lines: string[] = ["Filename,Title,Keywords,Category"];

  for (const { image, upscale } of items) {
    const url = upscale?.url ?? image.image_link;
    const { name: filename, renamed } = dedupeFilename(filenameFromUrl(url), used);
    if (renamed) warnings.push(`Filename collision renamed to "${filename}".`);
    used.set(filename, (used.get(filename) ?? 0) + 1);

    const adobe = image.metadata?.adobe_stock;
    const title = adobe?.title || image.title;
    const keywords = clipKeywords(keywordsOf(image, "adobe_stock"), 49, title, warnings);
    const category = adobe?.category || image.category;
    const categoryId = ADOBE_CATEGORY_IDS[category];
    if (categoryId === undefined) {
      warnings.push(`"${title}": unknown Adobe category "${category}" — fix the CSV before upload.`);
    }

    lines.push(
      [
        csvField(filename),
        csvField(title),
        csvField(keywords.join(", ")),
        categoryId === undefined ? "" : String(categoryId),
      ].join(","),
    );
  }

  return {
    csv: lines.join("\r\n") + "\r\n",
    rows: items.length,
    warnings,
    filename: `adobe-stock-upload-${new Date().toISOString().slice(0, 10)}.csv`,
  };
}

// ── Shutterstock ────────────────────────────────────────────────────────────

export function buildShutterstockCsv(items: CsvSelectionItem[]): CsvResult {
  const warnings: string[] = [];
  const used = new Map<string, number>();
  const lines: string[] = ["Filename,Description,Keywords,Categories"];

  for (const { image, upscale } of items) {
    const url = upscale?.url ?? image.image_link;
    const { name: filename, renamed } = dedupeFilename(filenameFromUrl(url), used);
    if (renamed) warnings.push(`Filename collision renamed to "${filename}".`);
    used.set(filename, (used.get(filename) ?? 0) + 1);

    const ss = image.metadata?.shutterstock;
    const description = ss?.description || image.title;
    if (description.length > 200) {
      warnings.push(`"${image.title}": description longer than 200 chars (Shutterstock limit).`);
    }
    const keywords = clipKeywords(keywordsOf(image, "shutterstock"), 50, image.title, warnings);
    if (keywords.length < 7) {
      warnings.push(`"${image.title}": only ${keywords.length} keywords — Shutterstock requires at least 7.`);
    }

    let categories = (ss?.categories ?? []).filter((c) =>
      (SHUTTERSTOCK_CATEGORIES as readonly string[]).includes(c),
    );
    if (!categories.length) categories = ["Objects"];
    if (categories.length > 2) {
      categories = categories.slice(0, 2);
      warnings.push(`"${image.title}": categories truncated to 2 (Shutterstock limit).`);
    }

    lines.push(
      [
        csvField(filename),
        csvField(description),
        csvField(keywords.join(", ")),
        csvField(categories.join(", ")),
      ].join(","),
    );
  }

  return {
    csv: lines.join("\r\n") + "\r\n",
    rows: items.length,
    warnings,
    filename: `shutterstock-upload-${new Date().toISOString().slice(0, 10)}.csv`,
  };
}

// ── Dreamstime ──────────────────────────────────────────────────────────────

export function buildDreamstimeCsv(items: CsvSelectionItem[]): CsvResult {
  const warnings: string[] = [];
  const used = new Map<string, number>();
  const lines: string[] = ["Filename,Title,Description,Keywords"];

  for (const { image, upscale } of items) {
    const url = upscale?.url ?? image.image_link;
    const { name: filename, renamed } = dedupeFilename(filenameFromUrl(url), used);
    if (renamed) warnings.push(`Filename collision renamed to "${filename}".`);
    used.set(filename, (used.get(filename) ?? 0) + 1);

    const ds = image.metadata?.dreamstime;
    const title = ds?.title || image.title;
    if (title.length < 5) warnings.push(`"${image.title}": Dreamstime titles need 5-250 characters.`);
    const description = ds?.description || image.title;
    const keywords = clipKeywords(keywordsOf(image, "dreamstime"), 50, image.title, warnings);
    if (keywords.length < 7) {
      warnings.push(`"${image.title}": only ${keywords.length} keywords — Dreamstime requires 7-50.`);
    }

    lines.push(
      [
        csvField(filename),
        csvField(title),
        csvField(description),
        csvField(keywords.join(", ")),
      ].join(","),
    );
  }

  return {
    csv: lines.join("\r\n") + "\r\n",
    rows: items.length,
    warnings,
    filename: `dreamstime-upload-${new Date().toISOString().slice(0, 10)}.csv`,
  };
}

// ── 123RF (every field double-quoted, ≤ 2 MB) ───────────────────────────────

export function build123RfCsv(items: CsvSelectionItem[]): CsvResult {
  const warnings: string[] = [];
  const used = new Map<string, number>();
  const lines: string[] = ['"oldfilename","123rf_filename","description","keywords","country"'];

  for (const { image, upscale } of items) {
    const url = upscale?.url ?? image.image_link;
    const { name: filename, renamed } = dedupeFilename(filenameFromUrl(url), used);
    if (renamed) warnings.push(`Filename collision renamed to "${filename}".`);
    used.set(filename, (used.get(filename) ?? 0) + 1);

    const rf = image.metadata?.["123rf"];
    let description = rf?.description || image.title;
    if (description.length > 180) {
      description = description.slice(0, 180);
      warnings.push(`"${image.title}": description clipped to 180 chars (123RF limit).`);
    }
    const keywords = clipKeywords(keywordsOf(image, "123rf"), 50, image.title, warnings);
    if (keywords.length < 7) {
      warnings.push(`"${image.title}": only ${keywords.length} keywords — 123RF requires at least 7.`);
    }

    const q = (v: string) => `"${v.replace(/"/g, "")}"`;
    lines.push(
      [q(filename), q(""), q(description), q(keywords.join(", ")), q("")].join(","),
    );
  }

  return {
    csv: lines.join("\r\n") + "\r\n",
    rows: items.length,
    warnings,
    filename: `123rf-upload-${new Date().toISOString().slice(0, 10)}.csv`,
  };
}

// ── Pond5 (plain ASCII, no quotes/special chars) ────────────────────────────

export function buildPond5Csv(items: CsvSelectionItem[]): CsvResult {
  const warnings: string[] = [];
  const used = new Map<string, number>();
  const lines: string[] = ["originalfilename,title,description,keywords,price"];

  for (const { image, upscale } of items) {
    const url = upscale?.url ?? image.image_link;
    const { name: filename, renamed } = dedupeFilename(filenameFromUrl(url), used);
    if (renamed) warnings.push(`Filename collision renamed to "${filename}".`);
    used.set(filename, (used.get(filename) ?? 0) + 1);

    const p5 = image.metadata?.pond5;
    const title = pond5Field(p5?.title || image.title).slice(0, 80);
    if (title.length < 3) warnings.push(`"${image.title}": Pond5 titles need 3-80 plain-ASCII characters.`);
    const description = pond5Field(p5?.description || image.title);
    const keywords = clipKeywords(keywordsOf(image, "pond5"), 50, image.title, warnings)
      .map(pond5Field)
      .filter(Boolean);
    if (keywords.length < 5) {
      warnings.push(`"${image.title}": only ${keywords.length} keywords — Pond5 requires at least 5.`);
    }
    const price = p5?.price ?? 5;

    lines.push([filename, title, description, keywords.join(", "), String(price)].join(","));
  }

  return {
    csv: lines.join("\r\n") + "\r\n",
    rows: items.length,
    warnings,
    filename: `pond5-upload-${new Date().toISOString().slice(0, 10)}.csv`,
  };
}

// ── dispatcher ──────────────────────────────────────────────────────────────

/** Build the CSV for one platform. Returns null for platforms whose bulk-CSV
 *  format is not documented yet (the picker shows "coming soon"). */
export function buildPlatformCsv(platform: PlatformId, items: CsvSelectionItem[]): CsvResult | null {
  if (!CSV_READY_PLATFORMS.includes(platform)) return null;
  switch (platform) {
    case "adobe_stock":
      return buildAdobeStockCsv(items);
    case "shutterstock":
      return buildShutterstockCsv(items);
    case "dreamstime":
      return buildDreamstimeCsv(items);
    case "123rf":
      return build123RfCsv(items);
    case "pond5":
      return buildPond5Csv(items);
    default:
      return null;
  }
}

/** Trigger a browser download for the CSV text. */
export function downloadCsvFile(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
