import { useCallback, useEffect, useRef, useState } from "react";

// Autosave the way people can trust it (D-46): a trailing debounce so a
// pause saves quickly, a maximum wait so continuous typing still saves,
// and a visible "failed" state with the latest text kept locally until a
// retry succeeds. Never a toast; the label just changes.

export type SaveState =
  | { kind: "clean"; at: number | null }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "failed"; detail: string; localOnly: boolean };

const DEBOUNCE_MS = 600;
const MAX_WAIT_MS = 5000;
const RETRY_MS = [3000, 8000, 20000];

export function useAutosave<T>(
  key: string,
  save: (value: T) => Promise<void>,
  isEqual: (a: T, b: T) => boolean,
) {
  const [state, setState] = useState<SaveState>({ kind: "clean", at: null });
  const latest = useRef<T | null>(null);
  const lastSaved = useRef<T | null>(null);
  const debounce = useRef<number | null>(null);
  const maxWait = useRef<number | null>(null);
  const retry = useRef<number | null>(null);
  const attempts = useRef(0);
  const inFlight = useRef<Promise<boolean> | null>(null);

  const clearTimers = () => {
    if (debounce.current) window.clearTimeout(debounce.current);
    if (maxWait.current) window.clearTimeout(maxWait.current);
    if (retry.current) window.clearTimeout(retry.current);
    debounce.current = maxWait.current = retry.current = null;
  };

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimers();
    while (true) {
      const value = latest.current;
      if (value === null) return true;
      if (inFlight.current) {
        if (!(await inFlight.current)) return false;
        continue;
      }
      if (lastSaved.current !== null && isEqual(value, lastSaved.current)) {
        try { localStorage.removeItem(key); } catch { /* Local recovery is best-effort. */ }
        setState((s) => (s.kind === "clean" ? s : { kind: "clean", at: Date.now() }));
        return true;
      }
      const pending = (async () => {
        setState({ kind: "saving" });
        try {
          await save(value);
          lastSaved.current = value;
          attempts.current = 0;
          try { localStorage.removeItem(key); } catch { /* Local recovery is best-effort. */ }
          return true;
        } catch (e) {
          const failedValue = latest.current ?? value;
          try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), value: failedValue })); } catch { /* The editor still holds the text in memory. */ }
          const detail = e instanceof Error ? e.message : typeof e === "object" && e && "detail" in e ? String((e as { detail: unknown }).detail) : String(e);
          setState({ kind: "failed", detail, localOnly: true });
          const wait = RETRY_MS[Math.min(attempts.current, RETRY_MS.length - 1)];
          attempts.current += 1;
          retry.current = window.setTimeout(() => void flush(), wait);
          return false;
        } finally {
          inFlight.current = null;
        }
      })();
      inFlight.current = pending;
      if (!(await pending)) return false;
      if (latest.current !== null && !isEqual(latest.current, value)) setState({ kind: "dirty" });
    }
  }, [key, save, isEqual]);

  /** Call with the current value whenever it changes. */
  const update = useCallback((value: T) => {
    latest.current = value;
    if (lastSaved.current !== null && isEqual(value, lastSaved.current)) return;
    setState((s) => (s.kind === "failed" ? s : { kind: "dirty" }));
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => void flush(), DEBOUNCE_MS);
    if (!maxWait.current) maxWait.current = window.setTimeout(() => void flush(), MAX_WAIT_MS);
  }, [flush, isEqual]);

  /** Marks `value` as what the server already has (on load, after a generation). */
  const settle = useCallback((value: T) => {
    latest.current = value;
    lastSaved.current = value;
    clearTimers();
    setState({ kind: "clean", at: null });
  }, []);

  /** A copy kept locally after a failed save, if any. */
  const recover = useCallback((): { at: number; value: T } | null => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as { at: number; value: T }) : null;
    } catch { return null; }
  }, [key]);

  useEffect(() => () => clearTimers(), []);

  return { state, update, flush, settle, recover, retry: flush };
}
