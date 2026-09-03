"use client";

/**
 * API client — every request carries the app password (X-App-Password).
 * A 401 kicks the user back to the gate (password changed or wrong).
 */

import type { ListParams, ListResponse, Session, StockImage, ApiErrorPayload } from "./types";
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
    remove(id: string): Promise<{ data: { deleted: boolean; imagesDeleted: number } }> {
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFrom(image);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  },
};

function filenameFrom(image: StockImage): string {
  const ext = (image.image_link.split("?")[0].split(".").pop() || "png").toLowerCase().slice(0, 5);
  const slug = image.title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "image"}_${image._id}.${ext}`;
}
