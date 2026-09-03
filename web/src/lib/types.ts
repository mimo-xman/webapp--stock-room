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
