"use client";

/**
 * List state hook — owns pagination/search/filter/sort params,
 * fetches from the API (backend-enforced pagination — every filter change
 * is a fresh DB query, nothing is filtered client-side), allows local
 * optimistic patches + hard reloads after mutations.
 *
 * URL SYNC (opt-in via the third argument): the whole list state lives in
 * the page URL — /images?page=2&sort=used&category=Food… — so a reload, a
 * shared link or the browser Back button restores the exact result view.
 *   · mount   → params are read from window.location.search
 *   · change  → the URL is updated (rapid consecutive changes — e.g. typing
 *               a search — coalesce into ONE history entry; discrete changes
 *               each get their own, so Back walks back through them)
 *   · popstate→ params are re-read from the URL and the list refetches
 * Two lists can share one page (/sessions/:id): the second one prefixes
 * its keys (prefix: "ep" → ep_page, ep_limit…), each list only ever
 * touches its own keys in the shared query string.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ListParams, ListResponse, Pagination } from "@/lib/types";
import { DEFAULT_LIST_PARAMS } from "@/lib/types";
import { api } from "@/lib/api";
import { PAGE_SIZES } from "@/lib/constants";
import type { Session, StockImage, EtsyProduct } from "@/lib/types";

type Fetcher = (params: ListParams) => Promise<ListResponse<Session | StockImage | EtsyProduct>>;

/** URL sync options — see the hook doc. `filterKeys` lists the FilterBar
 *  keys this list owns in the URL (page context: pass [] for no filters). */
export interface UrlSyncOptions {
  prefix?: string;
  filterKeys?: string[];
}

const RESERVED_KEYS = ["page", "limit", "search", "sort", "order", "from", "to"];

function urlKey(prefix: string | undefined, key: string): string {
  return prefix ? `${prefix}_${key}` : key;
}

/** Read this list's params from window.location.search (client only). */
function readUrlListParams(opts: UrlSyncOptions): Partial<ListParams> | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const { prefix, filterKeys = [] } = opts;
  const out: Partial<ListParams> = {};

  const page = parseInt(sp.get(urlKey(prefix, "page")) || "", 10);
  if (Number.isInteger(page) && page >= 1) out.page = page;

  const limit = parseInt(sp.get(urlKey(prefix, "limit")) || "", 10);
  if ((PAGE_SIZES as readonly number[]).includes(limit)) out.limit = limit;

  const search = sp.get(urlKey(prefix, "search"));
  if (search) out.search = search.slice(0, 100);

  const sort = sp.get(urlKey(prefix, "sort"));
  if (sort) out.sort = sort.slice(0, 40);

  const order = sp.get(urlKey(prefix, "order"));
  if (order === "asc" || order === "desc") out.order = order;

  const from = sp.get(urlKey(prefix, "from"));
  if (from) out.from = from;
  const to = sp.get(urlKey(prefix, "to"));
  if (to) out.to = to;

  const filters: Record<string, string> = {};
  for (const key of filterKeys) {
    const v = sp.get(urlKey(prefix, key));
    if (v) filters[key] = v.slice(0, 80);
  }
  if (Object.keys(filters).length > 0) out.filters = filters;

  if (Object.keys(out).length === 0) return null;
  return out;
}

/** Write this list's params into the URL, preserving every other key
 *  (other lists on the same page). Next's history.state is carried over so
 *  the router stays in sync with our query-only entries. */
function writeUrlListParams(params: ListParams, opts: UrlSyncOptions, mode: "push" | "replace") {
  if (typeof window === "undefined") return;
  const { prefix, filterKeys = [] } = opts;
  const sp = new URLSearchParams(window.location.search);

  // drop every key this list owns, then set back only the non-default ones
  for (const key of [...RESERVED_KEYS, ...filterKeys]) sp.delete(urlKey(prefix, key));
  if (params.page !== DEFAULT_LIST_PARAMS.page) sp.set(urlKey(prefix, "page"), String(params.page));
  if (params.limit !== DEFAULT_LIST_PARAMS.limit) sp.set(urlKey(prefix, "limit"), String(params.limit));
  if (params.search) sp.set(urlKey(prefix, "search"), params.search);
  if (params.sort !== DEFAULT_LIST_PARAMS.sort) sp.set(urlKey(prefix, "sort"), params.sort);
  if (params.order !== DEFAULT_LIST_PARAMS.order) sp.set(urlKey(prefix, "order"), params.order);
  if (params.from) sp.set(urlKey(prefix, "from"), params.from);
  if (params.to) sp.set(urlKey(prefix, "to"), params.to);
  for (const [k, v] of Object.entries(params.filters)) {
    if (!v || !filterKeys.includes(k)) continue;
    sp.set(urlKey(prefix, k), v);
  }

  const qs = sp.toString();
  if (qs === window.location.search.replace(/^\?/, "")) return; // nothing to change
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  if (mode === "push") window.history.pushState(window.history.state, "", url);
  else window.history.replaceState(window.history.state, "", url);
}

export function useList(
  fetcher: Fetcher,
  initial?: Partial<ListParams>,
  urlOpts?: UrlSyncOptions,
) {
  const [params, setParams] = useState<ListParams>({
    ...DEFAULT_LIST_PARAMS,
    ...initial,
    filters: { ...(initial?.filters ?? {}) },
  });
  const [items, setItems] = useState<(Session | StockImage | EtsyProduct)[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  // Reset transient state when the query changes (adjust-during-render pattern).
  const queryKey = `${JSON.stringify(params)}#${nonce}`;
  const [prevKey, setPrevKey] = useState(queryKey);
  if (prevKey !== queryKey) {
    setPrevKey(queryKey);
    setLoading(true);
    setError(null);
  }

  // stable refs for the URL sync (pages pass literal option objects)
  const urlOptsRef = useRef(urlOpts);
  const initialRef = useRef(initial);
  const lastUrlWrite = useRef(0);
  const skipFirstWrite = useRef(Boolean(urlOpts));

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Hydration-safe URL adoption: the server HTML renders the DEFAULT list
  // state, so the URL params are adopted right after mount (reload / shared
  // link / back navigation). The default-params fetch that started during
  // mount is cancelled by its own cleanup when the params change — no stale
  // flash, one wasted request at most.
  useEffect(() => {
    if (!urlOptsRef.current) return;
    const fromUrl = readUrlListParams(urlOptsRef.current);
    if (fromUrl) {
      setParams((prev) => ({
        ...prev,
        ...fromUrl,
        filters: { ...prev.filters, ...(fromUrl.filters ?? {}) },
      }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetcher(params)
      .then((res) => {
        if (cancelled || !alive.current) return;
        setItems(res.data);
        setPagination(res.pagination);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled || !alive.current) return;
        setError(e?.payload?.message || e?.message || "Could not reach the API");
        setItems([]);
        setPagination(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params, nonce]);

  // URL sync — write the current params on every change. The very first
  // invocation (mount) is skipped: the URL is the input at that point, not
  // the output (the adoption effect above may still be applying it).
  // Rapid consecutive changes (typing a search, dragging the date) coalesce
  // into ONE history entry via replace; a discrete change after a pause gets
  // its own entry, so Back walks back through the views.
  useEffect(() => {
    if (!urlOptsRef.current) return;
    if (skipFirstWrite.current) {
      skipFirstWrite.current = false;
      return;
    }
    const now = Date.now();
    const mode = now - lastUrlWrite.current > 2000 ? "push" : "replace";
    lastUrlWrite.current = now;
    writeUrlListParams(params, urlOptsRef.current, mode);
  }, [params]);

  // Back / Forward between list states: re-read our keys from the URL and
  // refetch (a popstate with no keys of ours → back to the defaults).
  useEffect(() => {
    if (!urlOptsRef.current) return;
    function onPopState() {
      const fromUrl = readUrlListParams(urlOptsRef.current!);
      setParams((prev) => {
        const base: ListParams = {
          ...DEFAULT_LIST_PARAMS,
          ...initialRef.current,
          filters: { ...(initialRef.current?.filters ?? {}) },
        };
        const next = fromUrl
          ? { ...base, ...fromUrl, filters: { ...base.filters, ...(fromUrl.filters ?? {}) } }
          : base;
        next.filters = { ...next.filters };
        return next;
      });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  /** Any change other than page resets to page 1 (matches backend pagination). */
  const updateParams = useCallback((patch: Partial<ListParams>) => {
    setParams((prev) => {
      const next = { ...prev, ...patch, filters: { ...prev.filters, ...(patch.filters || {}) } };
      const keys = Object.keys(patch).filter((k) => k !== "page");
      if (keys.length > 0) next.page = 1;
      return next;
    });
  }, []);

  const updateFilter = useCallback((key: string, value: string) => {
    setParams((prev) => ({
      ...prev,
      filters: { ...prev.filters, [key]: value },
      page: 1,
    }));
  }, []);

  const reset = useCallback(() => {
    setParams({
      ...DEFAULT_LIST_PARAMS,
      sort: params.sort,
      order: params.order,
      limit: params.limit,
      filters: {},
    });
  }, [params.sort, params.order, params.limit]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  /** In-place patch of one row (optimistic update, or the fresh DB doc
   *  returned by a mutation — a full-doc patch refreshes the whole row). */
  const patchLocal = useCallback((id: string, patch: object) => {
    setItems((prev) => prev.map((it) => (it._id === id ? ({ ...it, ...patch } as Session | StockImage | EtsyProduct) : it)));
  }, []);

  return useMemo(
    () => ({ params, items, pagination, loading, error, nonce, updateParams, updateFilter, reset, reload, patchLocal }),
    [params, items, pagination, loading, error, nonce, updateParams, updateFilter, reset, reload, patchLocal],
  );
}

/** Sessions options for the images filter bar (up to 100). */
export function useSessionOptions() {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    api.sessions
      .list({ ...DEFAULT_LIST_PARAMS, limit: 100, sort: "title", order: "asc" })
      .then((res) => setOptions(res.data.map((s) => ({ value: s._id, label: s.title }))))
      .catch(() => setOptions([]));
  }, []);
  return options;
}
