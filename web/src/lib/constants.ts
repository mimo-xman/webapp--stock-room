/** Shared UI-side constants (kept in sync with the API's constants.js). */

import type { PlatformId } from "./types";

// ── the stock marketplaces (mirror of api/src/constants.js) ─────────────────

export interface PlatformDef {
  id: PlatformId;
  label: string;
  /** The metadata field used as the platform's display "title". */
  titleField: "title" | "description";
  /** Bulk CSV export supported with a documented format. */
  csv: boolean;
  /** AI-generated content policy badge (from research — verify on the
   *  platform itself, policies evolve). */
  ai: "accepted" | "refused" | "verify";
  aiNote: string;
}

export const PLATFORMS: PlatformDef[] = [
  {
    id: "adobe_stock",
    label: "Adobe Stock",
    titleField: "title",
    csv: true,
    ai: "accepted",
    aiNote: "AI content accepted as Generative AI (labeled).",
  },
  {
    id: "shutterstock",
    label: "Shutterstock",
    titleField: "description",
    csv: true,
    ai: "verify",
    aiNote: "AI policy has changed over time — check the current contributor rules before uploading.",
  },
  {
    id: "istock",
    label: "iStock / Getty",
    titleField: "title",
    csv: false,
    ai: "refused",
    aiNote: "AI-generated content NOT accepted. Metadata is stored for when the policy changes.",
  },
  {
    id: "wirestock",
    label: "Wirestock",
    titleField: "title",
    csv: false,
    ai: "accepted",
    aiNote: "AI content accepted but MUST be disclosed in title, description and keywords.",
  },
  {
    id: "pond5",
    label: "Pond5",
    titleField: "title",
    csv: true,
    ai: "refused",
    aiNote: "AI-generated content NOT accepted (2025 policy). Metadata is stored for when the policy changes.",
  },
  {
    id: "depositphotos",
    label: "Depositphotos",
    titleField: "description",
    csv: false,
    ai: "refused",
    aiNote: "AI-generated images NOT accepted. Metadata is stored for when the policy changes.",
  },
  {
    id: "123rf",
    label: "123RF",
    titleField: "description",
    csv: true,
    ai: "accepted",
    aiNote: "AI images and videos accepted.",
  },
  {
    id: "dreamstime",
    label: "Dreamstime",
    titleField: "title",
    csv: true,
    ai: "accepted",
    aiNote: "AI content accepted (no AI people — our content rules already ban living beings).",
  },
];

export const PLATFORM_IDS = PLATFORMS.map((p) => p.id);

export function platformLabel(id: string): string {
  return PLATFORMS.find((p) => p.id === id)?.label ?? id;
}

/** Field the UI shows as the "title" for a platform block. */
export function platformTitleOf(md: Record<string, unknown> | undefined, id: PlatformId): string {
  const block = (md?.[id] ?? {}) as Record<string, unknown>;
  const def = PLATFORMS.find((p) => p.id === id);
  const v = block[def?.titleField ?? "title"];
  return typeof v === "string" ? v : "";
}

export function platformKeywordsOf(md: Record<string, unknown> | undefined, id: PlatformId): string[] {
  const block = (md?.[id] ?? {}) as Record<string, unknown>;
  return Array.isArray(block.keywords) ? (block.keywords as string[]) : [];
}

// ── category lists (exact official values) ──────────────────────────────────

export const CATEGORIES = [
  "Animals",
  "Buildings and Architecture",
  "Business",
  "Drinks",
  "The Environment",
  "States of Mind",
  "Food",
  "Graphic Resources",
  "Hobbies and Leisure",
  "Industry",
  "Landscapes",
  "Lifestyle",
  "People",
  "Plants and Flowers",
  "Culture and Religion",
  "Science",
  "Social Issues",
  "Sports",
  "Technology",
  "Transport",
  "Travel",
] as const;

export const SHUTTERSTOCK_CATEGORIES = [
  "Abstract",
  "Animals/Wildlife",
  "Arts",
  "Backgrounds/Textures",
  "Beauty/Fashion",
  "Buildings/Landmarks",
  "Business/Finance",
  "Celebrities",
  "Education",
  "Food and drink",
  "Healthcare/Medical",
  "Holidays",
  "Industrial",
  "Interiors",
  "Miscellaneous",
  "Nature",
  "Objects",
  "Parks/Outdoor",
  "People",
  "Religion",
  "Science",
  "Signs/Symbols",
  "Sports/Recreation",
  "Technology",
  "Transportation",
  "Vintage",
] as const;

// ── Etsy product types ──────────────────────────────────────────────────────

export const ETSY_PRODUCT_TYPES = [
  { value: "coloring_book", label: "Coloring book (PDF)" },
  { value: "activity_book", label: "Activity book (PDF)" },
  { value: "party_invitations", label: "Party invitations" },
  { value: "wall_art_set", label: "Wall art set" },
  { value: "printable_set", label: "Printable set" },
  { value: "clipart_bundle", label: "Clipart bundle" },
  { value: "digital_download", label: "Digital download" },
  { value: "other", label: "Other" },
] as const;

export function etsyProductTypeLabel(v: string): string {
  return ETSY_PRODUCT_TYPES.find((t) => t.value === v)?.label ?? v;
}

// ── Etsy image roles (mirror of the API's ETSY_IMAGE_ROLES) ─────────────────

/** `marketing` = the ANNOUNCEMENT images: the Etsy listing photos that
 *  present the product to buyers (mockups, "what's inside" collages, page
 *  samples). They are NOT part of the deliverable — cover/pages/assets are —
 *  but they upscale exactly like every other image. */
export const ETSY_IMAGE_ROLES = [
  { value: "cover", label: "Cover" },
  { value: "page", label: "Page" },
  { value: "asset", label: "Asset" },
  { value: "preview", label: "Preview" },
  { value: "marketing", label: "Marketing (announcement)" },
] as const;

export function etsyImageRoleLabel(v: string): string {
  return ETSY_IMAGE_ROLES.find((r) => r.value === v)?.label ?? v;
}

// ── listing conventions ─────────────────────────────────────────────────────

export const QUALITIES = ["1K", "2K", "4K"] as const;

export const RATIOS = [
  "Auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "2:1",
  "1:2",
  "3:1",
  "1:3",
  "21:9",
  "9:21",
] as const;

export const PAGE_SIZES = [5, 10, 20, 50, 100] as const;

export const SESSION_SORTS = [
  { value: "createdAt", label: "Created" },
  { value: "updatedAt", label: "Updated" },
  { value: "title", label: "Title" },
  { value: "imagesCount", label: "Images" },
  { value: "productsCount", label: "Products" },
] as const;

// Sort keys mirror the API's `sort` values — `used` maps to the used_count
// mirror (used on ANY platform); `category` sorts on the Adobe category.
export const IMAGE_SORTS = [
  { value: "createdAt", label: "Created" },
  { value: "updatedAt", label: "Updated" },
  { value: "title", label: "Title" },
  { value: "category", label: "Category" },
  { value: "used", label: "Used" },
  { value: "quality", label: "Quality" },
  { value: "ratio", label: "Ratio" },
  { value: "prompt", label: "Prompt" },
] as const;

export const ETSY_SORTS = [
  { value: "createdAt", label: "Created" },
  { value: "updatedAt", label: "Updated" },
  { value: "title", label: "Title" },
  { value: "productType", label: "Type" },
  { value: "usedInEtsy", label: "Listed" },
  { value: "imagesCount", label: "Images" },
] as const;
