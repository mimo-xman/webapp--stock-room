/** API data types (mirror api/src/models). */

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Session {
  _id: string;
  title: string;
  imagesCount: number;
  usedCount?: number;
  productsCount?: number;
  productsUsedCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type Quality = "1K" | "2K" | "4K";

export type PlatformId =
  | "adobe_stock"
  | "shutterstock"
  | "istock"
  | "wirestock"
  | "pond5"
  | "depositphotos"
  | "123rf"
  | "dreamstime";

// ── per-platform metadata blocks (mirror the API's zod schemas) ─────────────

export interface AdobeStockMeta {
  title: string;
  category: string;
  keywords: string[];
}

export interface ShutterstockMeta {
  description: string;
  categories: string[];
  keywords: string[];
}

export interface IStockMeta {
  title: string;
  description: string;
  keywords: string[];
}

export interface WirestockMeta {
  title: string;
  description: string;
  keywords: string[];
}

export interface Pond5Meta {
  title: string;
  description: string;
  keywords: string[];
  price?: number;
}

export interface DepositphotosMeta {
  description: string;
  keywords: string[];
}

export interface RF123Meta {
  description: string;
  keywords: string[];
}

export interface DreamstimeMeta {
  title: string;
  description: string;
  keywords: string[];
}

export type PlatformMetadata = {
  adobe_stock?: AdobeStockMeta;
  shutterstock?: ShutterstockMeta;
  istock?: IStockMeta;
  wirestock?: WirestockMeta;
  pond5?: Pond5Meta;
  depositphotos?: DepositphotosMeta;
  "123rf"?: RF123Meta;
  dreamstime?: DreamstimeMeta;
};

export type PlatformUsed = Partial<Record<PlatformId, boolean>>;

/** One Real-ESRGAN upscale variant on an image (see docs/UPSCALE.md).
 *  `used_in_adobe_stock` is DERIVED: an upscale is the same image as its
 *  original (only bigger), so it follows the original's used state — the
 *  API propagates used.adobe_stock onto every variant whenever the image
 *  is stamped, and there is no per-variant mark-used anymore. */
export interface Upscale {
  _id: string;
  url: string;
  public_id?: string;
  scale: number;
  model: string;
  width?: number;
  height?: number;
  size_bytes?: number;
  source?: "github-actions" | "manual";
  run_id?: string;
  /** Mirrors the parent image's used.adobe_stock (derived, read-only). */
  used_in_adobe_stock?: boolean;
  created_at?: string;
}

/**
 * One sellable image (collection images_to_bay): sold individually on the
 * stock marketplaces, each with its own per-platform upload metadata and
 * per-platform "used" flags.
 *
 * `title` / `category` / `keywords` / `used_in_adobe_stock` are legacy flat
 * projections kept by the API for compatibility (mirrored from
 * metadata.adobe_stock / used.adobe_stock).
 */
export interface StockImage {
  _id: string;
  session_id: string;
  prompt: string;
  ratio: string;
  quality: Quality;
  image_link: string;
  metadata: PlatformMetadata;
  used: PlatformUsed;
  /** Number of platforms where the image is marked used (sort/filter). */
  used_count?: number;
  /** Legacy flat projections (from metadata.adobe_stock). */
  title: string;
  category: string;
  keywords: string[];
  used_in_adobe_stock: boolean;
  /** Batch-worker coordination (parallel upscale workflow). Absent on
   *  images created before the feature — treat absent as active/not-in-use. */
  active?: boolean;
  in_use?: boolean;
  in_use_at?: string;
  error_message?: string;
  /** Upscaled variants (Real-ESRGAN via GitHub Actions) — absent on images
   *  created before the feature; always use `image.upscales ?? []`. */
  upscales?: Upscale[];
  createdAt: string;
  updatedAt: string;
}

// ── Etsy digital products ───────────────────────────────────────────────────

export type EtsyProductType =
  | "coloring_book"
  | "activity_book"
  | "party_invitations"
  | "wall_art_set"
  | "printable_set"
  | "clipart_bundle"
  | "digital_download"
  | "other";

export type EtsyImageRole = "cover" | "page" | "asset" | "preview" | "marketing";

export interface EtsyProductImage {
  _id?: string;
  image_link: string;
  role: EtsyImageRole;
  caption: string;
  /** The exact generation prompt that produced this image (agent traceability). */
  prompt?: string;
  ratio: string;
  quality: string;
  upscales?: Upscale[];
  /** Batch-worker coordination (parallel upscale workflow) — same semantics
   *  as StockImage. Absent on images migrated before the feature — treat
   *  absent as active/not-in-use. */
  active?: boolean;
  in_use?: boolean;
  in_use_at?: string;
  error_message?: string;
}

export interface EtsyProductMetadata {
  title: string;
  description: string;
  tags: string[];
  category: string;
  price?: number;
}

export interface EtsyProduct {
  _id: string;
  session_id: string;
  product_type: EtsyProductType;
  images: EtsyProductImage[];
  metadata: EtsyProductMetadata;
  file_link: string;
  used_in_etsy: boolean;
  imagesCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListResponse<T> {
  data: T[];
  pagination: Pagination;
}

export interface ListParams {
  page: number;
  limit: number;
  search: string;
  sort: string;
  order: "asc" | "desc";
  from: string;
  to: string;
  filters: Record<string, string>;
}

export const DEFAULT_LIST_PARAMS: ListParams = {
  page: 1,
  limit: 10,
  search: "",
  sort: "createdAt",
  order: "desc",
  from: "",
  to: "",
  filters: {},
};

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: { path: string; message: string }[];
}

// ── bulk mark-as-used (webapp checkbox multi-selection) ─────────────────────

/** POST /api/images/bulk-used result — `marked` images were processed (found
 *  and answered), `changed` had at least one used flag actually flip
 *  (already-marked targets are skipped and stay marked); the updated image
 *  docs (for in-place grid patches — their upscales carry the propagated
 *  used_in_adobe_stock) and any targets that no longer exist. */
export interface BulkUsedResult {
  marked: number;
  changed: number;
  images: StockImage[];
  missing: { image_id: string }[];
}

/** POST /api/images/bulk-fetch result — the FRESH docs of every selected
 *  image (request order), plus the ids that no longer exist. The webapp
 *  re-reads the selection from the DB before acting on it (platform-picker
 *  stats, CSV build) — the grid snapshot is never trusted for reads. */
export interface BulkFetchResult {
  images: StockImage[];
  missing: { image_id: string }[];
}

// ── stuck worker claims (in_use reservations left by force-stopped runs) ──

/** A sellable image (images_to_bay) currently reserved by a batch worker. */
export interface ClaimedImage {
  _id: string;
  title: string;
  in_use_at: string | null;
  upscales: number;
  active: boolean;
}

/** An Etsy product image currently reserved by a batch worker. */
export interface ClaimedEtsyImage {
  product_id: string;
  product_title: string;
  image_id: string | null;
  image_index: number;
  role: EtsyImageRole;
  caption: string;
  in_use_at: string | null;
  upscales: number;
  active: boolean;
}

export interface ClaimsSnapshot {
  total: number;
  images: ClaimedImage[];
  etsy: ClaimedEtsyImage[];
}

export interface ClaimsReleaseResult {
  source: "images" | "etsy" | "all";
  images_released: number;
  etsy_images_released: number;
  total: number;
}
