// Every call into the native side goes through this module. Nothing else in
// src/ imports @tauri-apps/*, so a browser-hosted build is one module swap.
// `VITE_LITA_MOCK=1` swaps in the in-browser mock (src/platform/mock.ts) so
// every screen can be rendered and screenshotted without Tauri.

import type { Host } from "./types";
import { tauriHost } from "./tauri";
import { mockHost } from "./mock";

export * from "./types";

export const host: Host = import.meta.env.VITE_LITA_MOCK ? mockHost : tauriHost;
