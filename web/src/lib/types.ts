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
  createdAt: string;
  updatedAt: string;
}

export type Quality = "1K" | "2K" | "4K";

/** One Real-ESRGAN upscale variant on an image (see docs/UPSCALE.md). */
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
  used_in_adobe_stock?: boolean;
  created_at?: string;
}

export interface StockImage {
  _id: string;
  session_id: string;
  prompt: string;
  ratio: string;
  quality: Quality;
  image_link: string;
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
