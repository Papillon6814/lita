// The Tauri implementation of the host. Only this file and mock.ts know
// how commands are reached.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type * as T from "./types";

export const tauriHost: T.Host = {
  codexStatus: () => invoke<T.CodexStatus>("codex_status"),
  sessionStatus: () => invoke<T.SessionStatus>("session_status"),
  signIn: () => invoke<T.SessionStatus>("sign_in"),
  cancelSignIn: () => invoke<void>("cancel_sign_in"),
  signOut: () => invoke<T.SessionStatus>("sign_out"),
  listVoices: () => invoke<T.VoiceSummary[]>("list_voices"),
  getVoice: (id: string) => invoke<T.Voice | null>("get_voice", { id }),
  deleteVoice: (id: string) => invoke<boolean>("delete_voice", { id }),
  renameVoice: (id: string, name: string) => invoke<void>("rename_voice", { id, name }),
  updateVoiceProfile: (id: string, profile: T.VoiceProfile) => invoke<T.Voice | null>("update_voice_profile", { id, profile }),
  createVoice: (name: string, sources: T.SourceInput[]) => invoke<T.Voice>("create_voice", { name, sources }),
  cancelVoiceBuild: () => invoke<void>("cancel_voice_build"),
  materialBudget: () => invoke<T.MaterialBudget>("material_budget"),
  platforms: () => invoke<T.Platform[]>("platforms"),
  previewPrompt: (voiceId: string, brief: string, platformId: string, previous?: string) =>
    invoke<string>("preview_prompt", { voiceId, brief, platformId, previous: previous ?? null }),
  generateDraft: (voiceId: string, brief: string, platformId: string, effort: T.Effort, previous?: string) =>
    invoke<T.Generated>("generate_draft", { voiceId, brief, platformId, effort, previous: previous ?? null }),
  cancelGenerate: () => invoke<void>("cancel_generate"),
  setDraftStatus: (id: string, status: T.DraftStatus) => invoke<void>("set_draft_status", { id, status }),
  listArticles: (status) => invoke<T.ArticleSummary[]>("list_articles", { status: status ?? null }),
  getArticle: (id) => invoke<T.Article | null>("get_article", { id }),
  createArticle: (platformId, voiceId) => invoke<T.Article>("create_article", { platformId: platformId ?? null, voiceId: voiceId ?? null }),
  updateArticle: (id, patch) => invoke<void>("update_article", { id, patch }),
  deleteArticle: (id) => invoke<boolean>("delete_article", { id }),
  listVersions: (articleId) => invoke<T.ArticleVersion[]>("list_versions", { articleId }),
  snapshotArticle: (articleId, manual) => invoke<T.ArticleVersion | null>("snapshot_article", { articleId, manual }),
  restoreVersion: (versionId) => invoke<T.Article>("restore_version", { versionId }),
  generateIntoArticle: (articleId, effort, previous) => invoke<T.ArticleWritten>("generate_into_article", { articleId, effort, previous: previous ?? null }),
  getSettings: () => invoke<T.UserSettings>("get_settings"),
  setDefaultVoice: (voiceId) => invoke<void>("set_default_voice", { voiceId }),
  copyText: (text: string) => writeText(text),
  importNote: (account: string) => invoke<T.Imported>("import_note", { account }),
  importMedium: (handle: string) => invoke<T.Imported>("import_medium", { handle }),
  importXArchive: (contents: string, handle: string | null, includeReplies: boolean) =>
    invoke<T.Imported>("import_x_archive", { contents, handle, includeReplies }),
  onVoiceProgress: (handler: (p: T.VoiceProgress) => void): Promise<UnlistenFn> =>
    listen<T.VoiceProgress>("voice-progress", (e) => handler(e.payload)),
  openExternal: (url: string) => openUrl(url),
};
