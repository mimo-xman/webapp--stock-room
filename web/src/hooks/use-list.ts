"use client";

/**
 * List state hook — owns pagination/search/filter/sort params,
 * fetches from the API (backend-enforced pagination), allows
 * local optimistic patches + hard reloads after mutations.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ListParams, ListResponse, Pagination } from "@/lib/types";
import { DEFAULT_LIST_PARAMS } from "@/lib/types";
import { api } from "@/lib/api";
import type { Session, StockImage } from "@/lib/types";

type Fetcher = (params: ListParams) => Promise<ListResponse<Session | StockImage>>;

export function useList(fetcher: Fetcher, initial?: Partial<ListParams>) {
  const [params, setParams] = useState<ListParams>({
    ...DEFAULT_LIST_PARAMS,
    ...initial,
    filters: { ...(initial?.filters ?? {}) },
  });
  const [items, setItems] = useState<(Session | StockImage)[]>([]);
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

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
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

  /** Optimistic local patch (e.g. stamp toggle) — reload to confirm. */
  const patchLocal = useCallback((id: string, patch: Partial<StockImage>) => {
    setItems((prev) => prev.map((it) => (it._id === id ? { ...it, ...patch } : it)));
  }, []);

  return useMemo(
    () => ({ params, items, pagination, loading, error, nonce, updateParams, updateFilter, reset, reload, patchLocal }),
    [params, items, pagination, loading, error, nonce, updateParams, updateFilter, reset, reload, patchLocal]
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
