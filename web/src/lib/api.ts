"use client";

/**
 * API client — every request carries the app password (X-App-Password).
 * A 401 kicks the user back to the gate (password changed or wrong).
 */

import type { ListParams, ListResponse, Session, StockImage, Upscale, EtsyProduct, EtsyProductImage, EtsyProductMetadata, EtsyProductType, EtsyImageRole, ApiErrorPayload } from "./types";
import { getAppPassword, clearAppPassword } from "./auth";

function resolveApiUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  // Local development without an env file: the API runs beside the app.
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") return "http://localhost:3333";
  }
  return "";
}

export const API_URL = resolveApiUrl();

export class ApiError extends Error {
  status: number;
  payload?: ApiErrorPayload;

  constructor(status: number, payload?: ApiErrorPayload) {
    super(payload?.message || `Request failed (HTTP ${status})`);
    this.status = status;
    this.payload = payload;
  }
}

function kickToGate() {
  clearAppPassword();
  if (typeof window !== "undefined" && window.location.pathname !== "/") {
    window.location.replace("/");
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const password = getAppPassword();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(password ? { "X-App-Password": password } : {}),
      ...(init.headers || {}),
    },
  });

  if (res.status === 401) {
    kickToGate();
    throw new ApiError(401, { code: "AUTH_REQUIRED", message: "Session expired — sign in again" });
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, (json && json.error) || undefined);
  }
  return json as T;
}

export function buildListQuery(params: ListParams): string {
  const q = new URLSearchParams();
  q.set("page", String(params.page));
  q.set("limit", String(params.limit));
  if (params.search) q.set("search", params.search);
  q.set("sort", params.sort);
  q.set("order", params.order);
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  for (const [k, v] of Object.entries(params.filters)) {
    if (v !== "" && v !== undefined) q.set(k, v);
  }
  return q.toString();
}

// ── typed API surface ──────────────────────────────────────────────────────

export const api = {
  verifyPassword(password: string) {
    return request<{ ok: boolean; role: string }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },

  sessions: {
    list(params: ListParams): Promise<ListResponse<Session>> {
      return request(`/api/sessions?${buildListQuery(params)}`);
    },
    get(id: string): Promise<{ data: Session }> {
      return request(`/api/sessions/${id}`);
    },
    create(title: string): Promise<{ data: Session }> {
      return request("/api/sessions", { method: "POST", body: JSON.stringify({ title }) });
    },
    remove(id: string): Promise<{ data: { deleted: boolean; imagesDeleted: number; productsDeleted?: number } }> {
      return request(`/api/sessions/${id}`, { method: "DELETE" });
    },
  },

  images: {
    list(params: ListParams): Promise<ListResponse<StockImage>> {
      return request(`/api/images?${buildListQuery(params)}`);
    },
    get(id: string): Promise<{ data: StockImage }> {
      return request(`/api/images/${id}`);
    },
    create(payload: Partial<StockImage>): Promise<{ data: StockImage }> {
      return request("/api/images", { method: "POST", body: JSON.stringify(payload) });
    },
    update(id: string, patch: Partial<StockImage>): Promise<{ data: StockImage }> {
      return request(`/api/images/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    },
    remove(id: string): Promise<{ data: { deleted: boolean } }> {
      return request(`/api/images/${id}`, { method: "DELETE" });
    },
    /** Download via the server proxy (avoids CORS / dead-link issues). */
    async download(image: StockImage): Promise<void> {
      const password = getAppPassword();
      const res = await fetch(`${API_URL}/api/images/${image._id}/download`, {
        headers: password ? { "X-App-Password": password } : {},
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new ApiError(res.status, (json && json.error) || undefined);
      }
      const blob = await res.blob();
      saveBlob(blob, filenameFrom(image));
    },

    /** Upscaled variants (Real-ESRGAN via GitHub Actions). */
    upscales: {
      /** Toggle the "Mark used" stamp on one upscaled variant. */
      update(imageId: string, upscaleId: string, patch: { used_in_adobe_stock: boolean }): Promise<{ data: StockImage }> {
        return request(`/api/images/${imageId}/upscales/${upscaleId}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
      },
      /** Delete one variant — the server also destroys the Cloudinary asset
       *  when the API is configured with CLOUDINARY_* env vars. */
      remove(imageId: string, upscaleId: string): Promise<{ data: { deleted: boolean; upscalesRemaining: number; cloudinary?: { destroyed: boolean; note?: string } | null } }> {
        return request(`/api/images/${imageId}/upscales/${upscaleId}`, { method: "DELETE" });
      },
      /** Download one variant via the server proxy. */
      async download(image: StockImage, upscale: Upscale): Promise<void> {
        const password = getAppPassword();
        const res = await fetch(`${API_URL}/api/images/${image._id}/upscales/${upscale._id}/download`, {
          headers: password ? { "X-App-Password": password } : {},
        });
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          throw new ApiError(res.status, (json && json.error) || undefined);
        }
        const blob = await res.blob();
        const ext = (upscale.url.split("?")[0].split(".").pop() || "png").toLowerCase().slice(0, 5);
        saveBlob(blob, `${filenameFrom(image, "")}_x${upscale.scale}.${ext}`);
      },
    },
  },

  // ── Etsy digital products ──────────────────────────────────────────
  etsyProducts: {
    list(params: ListParams): Promise<ListResponse<EtsyProduct>> {
      return request(`/api/etsy-products?${buildListQuery(params)}`);
    },
    get(id: string): Promise<{ data: EtsyProduct }> {
      return request(`/api/etsy-products/${id}`);
    },
    create(payload: {
      session_id: string;
      product_type: EtsyProductType;
      images: Partial<EtsyProductImage>[];
      metadata: EtsyProductMetadata;
      file_link?: string;
      used_in_etsy?: boolean;
    }): Promise<{ data: EtsyProduct }> {
      return request("/api/etsy-products", { method: "POST", body: JSON.stringify(payload) });
    },
    update(id: string, patch: Partial<Omit<EtsyProduct, "metadata" | "images">> & { metadata?: Partial<EtsyProductMetadata> }): Promise<{ data: EtsyProduct }> {
      return request(`/api/etsy-products/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    },
    remove(id: string): Promise<{ data: { deleted: boolean } }> {
      return request(`/api/etsy-products/${id}`, { method: "DELETE" });
    },
    addImage(id: string, image: Partial<EtsyProductImage>): Promise<{ data: EtsyProduct }> {
      return request(`/api/etsy-products/${id}/images`, { method: "POST", body: JSON.stringify(image) });
    },

    /** Per-image edits: caption/role/link, pause & reactivate (active),
     *  dismiss the batch-worker error message. */
    images: {
      update(productId: string, imageId: string, patch: { role?: EtsyImageRole; caption?: string; image_link?: string; active?: boolean; error_message?: string }): Promise<{ data: EtsyProduct }> {
        return request(`/api/etsy-products/${productId}/images/${imageId}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
      },

      /** Remove ONE image from a product (refused on the last one — an
       *  Etsy product always needs at least one image). The server also
       *  destroys the image's upscale assets on Cloudinary (best-effort). */
      remove(productId: string, imageId: string): Promise<{ data: { deleted: boolean; imagesRemaining: number; upscalesDestroyed: number; cloudinary: { destroyed: number; kept: number } | null } }> {
        return request(`/api/etsy-products/${productId}/images/${imageId}`, { method: "DELETE" });
      },

      /** Download one product image via the server proxy (avoids CORS /
       *  dead-link issues). */
      async download(product: EtsyProduct, image: EtsyProductImage, index: number): Promise<void> {
        const password = getAppPassword();
        const res = await fetch(
          `${API_URL}/api/etsy-products/${product._id}/images/${image._id}/download`,
          { headers: password ? { "X-App-Password": password } : {} },
        );
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          throw new ApiError(res.status, (json && json.error) || undefined);
        }
        const blob = await res.blob();
        const ext = (image.image_link.split("?")[0].split(".").pop() || "png").toLowerCase().slice(0, 5);
        saveBlob(blob, `${slugProductFile(product, image, index)}.${ext}`);
      },
    },

    /** Upscaled variants on the nested product images (Real-ESRGAN via
     *  GitHub Actions — same protocol as the sellable images). */
    upscales: {
      /** Toggle the "Mark used" stamp on one variant of a product image. */
      update(productId: string, imageId: string, upscaleId: string, patch: { used_in_adobe_stock: boolean }): Promise<{ data: EtsyProduct }> {
        return request(`/api/etsy-products/${productId}/images/${imageId}/upscales/${upscaleId}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
      },

      /** Delete one variant — the server also destroys the Cloudinary asset
       *  when the API is configured with CLOUDINARY_* env vars. */
      remove(productId: string, imageId: string, upscaleId: string): Promise<{ data: { deleted: boolean; upscalesRemaining: number; cloudinary?: { destroyed: boolean; note?: string } | null } }> {
        return request(`/api/etsy-products/${productId}/images/${imageId}/upscales/${upscaleId}`, {
          method: "DELETE",
        });
      },

      /** Download one variant via the server proxy. */
      async download(product: EtsyProduct, image: EtsyProductImage, index: number, upscale: Upscale): Promise<void> {
        const password = getAppPassword();
        const res = await fetch(
          `${API_URL}/api/etsy-products/${product._id}/images/${image._id}/upscales/${upscale._id}/download`,
          { headers: password ? { "X-App-Password": password } : {} },
        );
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          throw new ApiError(res.status, (json && json.error) || undefined);
        }
        const blob = await res.blob();
        const ext = (upscale.url.split("?")[0].split(".").pop() || "png").toLowerCase().slice(0, 5);
        saveBlob(blob, `${slugProductFile(product, image, index)}_x${upscale.scale}.${ext}`);
      },
    },
  },
};

/** Download filename base for an Etsy product image (no extension). */
function slugProductFile(product: EtsyProduct, image: EtsyProductImage, index: number): string {
  const slug = (s: string) =>
    (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "image";
  const caption = image.caption?.trim() || `image-${index + 1}`;
  return `${slug(product.metadata?.title)}-${slug(caption)}`;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function filenameFrom(image: StockImage, suffix = `_${image._id}`): string {
  const ext = (image.image_link.split("?")[0].split(".").pop() || "png").toLowerCase().slice(0, 5);
  const slug = (image.title || image.metadata?.adobe_stock?.title || "image")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "image"}${suffix}.${ext}`;
}
