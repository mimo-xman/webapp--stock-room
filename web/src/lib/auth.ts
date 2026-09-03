"use client";

/**
 * The app password lives in sessionStorage — typed on each entry to the app
 * (new tab / closed session), cleared on lock or on 401 from the API.
 */

const KEY = "stockroom-app-password";

export function getAppPassword(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setAppPassword(password: string): void {
  try {
    window.sessionStorage.setItem(KEY, password);
  } catch {
    /* private mode — degrade gracefully */
  }
}

export function clearAppPassword(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
