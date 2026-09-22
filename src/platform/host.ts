// Every call into the native side goes through this module. Nothing else in
// src/ imports @tauri-apps/*, so a browser-hosted build later is one module
// swap rather than a rewrite.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

export type CodexStatus =
  | { status: "ready"; version: string }
  | { status: "not_logged_in"; version: string }
  | { status: "not_installed" }
  | { status: "error"; message: string };

export type SessionStatus =
  | { status: "signed_out" }
  | { status: "signed_in"; email: string | null };

export type SourceKind = "paste" | "file" | "note" | "medium" | "x";

export type SourceInput = { kind: SourceKind; origin: string | null; body: string };

export type VoiceProfile = {
  language: string;
  first_person: string;
  formality: string;
  tone: string[];
  sentence_endings: string[];
  avg_sentence_length_chars: number;
  preferred_words: string[];
  avoided_words: string[];
  opens_with: string;
  closes_with: string;
  uses_emoji: boolean;
  representative_excerpts: { excerpt: string; why: string }[];
};

export type VoiceSource = {
  id: string;
  kind: SourceKind;
  origin: string | null;
  body: string;
  created_at: string;
};

export type Voice = {
  id: string;
  name: string;
  profile: VoiceProfile;
  created_at: string;
  updated_at: string;
  voice_sources: VoiceSource[];
};

export type VoiceSummary = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  source_count: number;
};

export type VoiceProgress = { stage: "started" | "thinking" | "extracted" | "saved" };

export type Piece = { title: string | null; url: string | null; published_at: string | null; text: string };
export type Imported = { pieces: Piece[]; total: number | null; skipped_paid: number; recent_only: boolean };

export const host = {
  codexStatus: () => invoke<CodexStatus>("codex_status"),
  sessionStatus: () => invoke<SessionStatus>("session_status"),
  signIn: () => invoke<SessionStatus>("sign_in"),
  signOut: () => invoke<SessionStatus>("sign_out"),
  listVoices: () => invoke<VoiceSummary[]>("list_voices"),
  getVoice: (id: string) => invoke<Voice | null>("get_voice", { id }),
  deleteVoice: (id: string) => invoke<boolean>("delete_voice", { id }),
  createVoice: (name: string, sources: SourceInput[]) => invoke<Voice>("create_voice", { name, sources }),
  importNote: (account: string) => invoke<Imported>("import_note", { account }),
  importMedium: (handle: string) => invoke<Imported>("import_medium", { handle }),
  importXArchive: (contents: string, handle: string | null, includeReplies: boolean) =>
    invoke<Imported>("import_x_archive", { contents, handle, includeReplies }),
  onVoiceProgress: (handler: (p: VoiceProgress) => void): Promise<UnlistenFn> =>
    listen<VoiceProgress>("voice-progress", (e) => handler(e.payload)),
  openExternal: (url: string) => openUrl(url),
};
