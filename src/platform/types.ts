// Types shared by every host implementation (tauri.ts, mock.ts).


export type CodexStatus =
  | { status: "ready"; version: string }
  | { status: "not_logged_in"; version: string }
  | { status: "not_installed" }
  | { status: "error"; message: string };

export type SessionStatus =
  | { status: "restoring" }
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
  /** Codex's one sentence about the voice; empty on older profiles. */
  one_line: string;
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

/// How native commands fail: a stable code plus the raw detail.
export type UiError = { code: string; detail: string };

export type MaterialBudget = { per_piece_chars: number; total_chars: number };

export type Platform = { id: string; name: string; max_chars: number | null; rules: string };
export type Effort = "fast" | "quality";
export type DraftStatus = "pending" | "approved" | "discarded";
export type Draft = {
  id: string; brief_id: string; body: string; prompt_sent: string; model: string | null;
  elapsed_ms: number; status: DraftStatus; created_at: string; decided_at: string | null;
};
export type Generated = { draft: Draft; voice_notes: string };
export type Imported = { pieces: Piece[]; total: number | null; skipped_paid: number; recent_only: boolean };


export type Unlisten = () => void;

export type Host = {
  codexStatus: () => Promise<CodexStatus>;
  sessionStatus: () => Promise<SessionStatus>;
  signIn: () => Promise<SessionStatus>;
  cancelSignIn: () => Promise<void>;
  signOut: () => Promise<SessionStatus>;
  listVoices: () => Promise<VoiceSummary[]>;
  getVoice: (id: string) => Promise<Voice | null>;
  deleteVoice: (id: string) => Promise<boolean>;
  renameVoice: (id: string, name: string) => Promise<void>;
  updateVoiceProfile: (id: string, profile: VoiceProfile) => Promise<Voice | null>;
  createVoice: (name: string, sources: SourceInput[]) => Promise<Voice>;
  cancelVoiceBuild: () => Promise<void>;
  materialBudget: () => Promise<MaterialBudget>;
  platforms: () => Promise<Platform[]>;
  previewPrompt: (voiceId: string, brief: string, platformId: string) => Promise<string>;
  generateDraft: (voiceId: string, brief: string, platformId: string, effort: Effort) => Promise<Generated>;
  cancelGenerate: () => Promise<void>;
  setDraftStatus: (id: string, status: DraftStatus) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  importNote: (account: string) => Promise<Imported>;
  importMedium: (handle: string) => Promise<Imported>;
  importXArchive: (contents: string, handle: string | null, includeReplies: boolean) => Promise<Imported>;
  onVoiceProgress: (handler: (p: VoiceProgress) => void) => Promise<Unlisten>;
  openExternal: (url: string) => Promise<void>;
};
