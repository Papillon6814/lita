import { useCallback, useEffect, useRef, useState } from "react";
import { asUiError } from "../errors";
import type { UiError } from "../platform/types";

// Re-listing must not blank the screen (原則 2「正常時は静か」).
//
// Two rules live here, and every list on the app follows them:
//  1. What was shown last time stays on screen while the same thing is
//     fetched again. The swap happens when the new rows arrive, quietly.
//  2. The sentence "読み込んでいます…" only appears when there is nothing to
//     show *and* the fetch has already taken longer than SLOW_MS. A fetch
//     that returns in 200 ms shows no sentence at all.
//
// The cache is module-level on purpose: it must outlive the components, so
// that leaving the list and coming back paints instantly.

export const SLOW_MS = 300;

const cache = new Map<string, unknown>();

/** One key for the voices, so every screen shares the same remembered list. */
export const VOICES_KEY = "voices";
export const voiceKey = (id: string) => `voice:${id}`;

/** What was last fetched under this key, if anything. */
export function peek<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

/** Remember a value so the next paint of that key is instant. */
export function prime<T>(key: string, value: T): void {
  cache.set(key, value);
}

/** Forget a key, so the next load starts from nothing (after a delete). */
export function forget(key: string): void {
  cache.delete(key);
}

/** Forget everything: on sign-out, so the next person never sees the last one's rows. */
export function forgetAll(): void {
  cache.clear();
}

export type QuietLoad<T> = {
  /** The newest rows, or the previous ones while they are refetched. */
  value: T | undefined;
  /** True once something has been fetched (or was cached): before that, the screen stays blank rather than guessing "empty". */
  settled: boolean;
  /** True only while there is nothing to show and the fetch is slow. */
  slow: boolean;
  error: UiError | null;
  /** Fetch again, keeping what is on screen. */
  reload: () => Promise<void>;
};

export function useQuietLoad<T>(key: string, load: () => Promise<T>): QuietLoad<T> {
  const loadRef = useRef(load);
  loadRef.current = load;
  const live = useRef(true);
  const gen = useRef(0);

  const [state, setState] = useState(() => ({
    value: peek<T>(key),
    settled: cache.has(key),
    slow: false,
    error: null as UiError | null,
  }));

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const reload = useCallback(async () => {
    const mine = ++gen.current;
    const had = cache.has(key);
    setState({ value: peek<T>(key), settled: had, slow: false, error: null });
    const timer = window.setTimeout(() => {
      if (gen.current === mine && live.current && !had) setState((s) => ({ ...s, slow: true }));
    }, SLOW_MS);
    try {
      const value = await loadRef.current();
      cache.set(key, value);
      if (gen.current === mine && live.current) setState({ value, settled: true, slow: false, error: null });
    } catch (e) {
      if (gen.current === mine && live.current) setState((s) => ({ ...s, slow: false, error: asUiError(e) }));
    } finally {
      window.clearTimeout(timer);
    }
  }, [key]);

  useEffect(() => { void reload(); }, [reload]);

  return { ...state, reload };
}
