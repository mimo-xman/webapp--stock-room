/**
 * Adobe Stock CSV upload export — build the contributor metadata CSV.
 *
 * Adobe Stock lets contributors upload a batch of images, then attach their
 * metadata by uploading a CSV file with EXACTLY these columns:
 *
 *   Filename,Title,Keywords,Category
 *
 *   - Filename : full name of the uploaded asset incl. extension — we take
 *     the basename of the asset URL (`.../<image-name>.<ext>`).
 *   - Title    : already stored on the image doc (≤ 200 chars, API-enforced).
 *   - Keywords : comma-separated, max 49, relevance-ordered — joined from
 *     the image doc (truncated to 49 with a warning if needed).
 *   - Category : the NUMERIC code 1-21 (Adobe's list, same order as our
 *     CATEGORIES constant — index + 1).
 *
 * For an upscaled variant the row reuses the ORIGINAL image's Title /
 * Keywords / Category (they describe the same photo) — only the Filename
 * differs (the variant's own URL basename).
 *
 * CSV limits (Adobe): ≤ 20 000 rows, column names exact, values optional
 * except Filename. Releases column is omitted (no model/property releases
 * in this pipeline — no living beings by design).
 */

import { CATEGORIES } from "./constants";
import type { StockImage, Upscale } from "./types";

/** Adobe Stock category numeric codes — index + 1, exact same order as the
 *  21 official values (verified against Adobe's contributor help list). */
export const ADOBE_CATEGORY_IDS: Record<string, number> = Object.fromEntries(
  CATEGORIES.map((name, i) => [name, i + 1]),
);

/** Adobe's CSV keyword cap. */
export const ADOBE_MAX_KEYWORDS = 49;

/** One row to export: the image + optionally one specific upscale variant. */
export interface CsvSelectionItem {
  image: StockImage;
  /** When set, the row points at this upscaled variant (its URL basename
   *  becomes the Filename); metadata still comes from the original image. */
  upscale?: Upscale;
}

export interface AdobeStockCsvResult {
  /** Full CSV file content (header + rows, \r\n line endings). */
  csv: string;
  /** Number of data rows. */
  rows: number;
  /** Human-readable warnings (duplicate filenames, truncation…). */
  warnings: string[];
}

/** RFC 4180 field escaping: quote when the field contains a comma, a double
 *  quote or a newline; double the inner quotes. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
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

/** Build the Adobe Stock upload CSV from the selected items. */
export function buildAdobeStockCsv(items: CsvSelectionItem[]): AdobeStockCsvResult {
  const warnings: string[] = [];
  const usedFilenames = new Map<string, number>();
  const lines: string[] = ["Filename,Title,Keywords,Category"];

  for (const { image, upscale } of items) {
    const url = upscale?.url ?? image.image_link;
    let filename = filenameFromUrl(url);

    // Two selected assets must never share a Filename (Adobe matches rows to
    // files by name) — rename deterministically and warn.
    const seen = usedFilenames.get(filename) ?? 0;
    if (seen > 0) {
      const dot = filename.lastIndexOf(".");
      const stem = dot > 0 ? filename.slice(0, dot) : filename;
      const ext = dot > 0 ? filename.slice(dot) : "";
      filename = `${stem}-${seen + 1}${ext}`;
      warnings.push(`Filename collision renamed to "${filename}".`);
    }
    usedFilenames.set(filename, seen + 1);

    let keywords = image.keywords;
    if (keywords.length > ADOBE_MAX_KEYWORDS) {
      keywords = keywords.slice(0, ADOBE_MAX_KEYWORDS);
      warnings.push(`"${image.title}": keywords truncated to ${ADOBE_MAX_KEYWORDS} (Adobe limit).`);
    }

    // The API validates `category` against the exact 21 values, so the map
    // normally always hits — the fallback only guards legacy/manual rows.
    const categoryId = ADOBE_CATEGORY_IDS[image.category];
    if (categoryId === undefined) {
      warnings.push(`"${image.title}": unknown category "${image.category}" — fix the CSV before upload.`);
    }

    lines.push(
      [
        csvField(filename),
        csvField(image.title),
        csvField(keywords.join(", ")),
        categoryId === undefined ? "" : String(categoryId),
      ].join(","),
    );
  }

  if (items.length > 20000) {
    warnings.push("More than 20 000 rows — Adobe rejects CSV files above 20 000 rows.");
  }

  return { csv: lines.join("\r\n") + "\r\n", rows: items.length, warnings };
}

/** Trigger a browser download for the CSV text (mirrors api.ts saveBlob). */
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
