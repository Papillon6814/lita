// An in-browser stand-in for the native side, used only when the app is
// built with VITE_LITA_MOCK=1 (see `npm run mock`). It lets every screen be
// opened in an ordinary browser, which is how design reviews take their
// screenshots. The scene comes from the URL: `?scene=voice`, `?scene=write`…
//
// Scenes: signed-out, signing-in, codex-not-logged-in, codex-not-installed,
// intake, intake-loaded, building, voice, voice-open, write, write-generating,
// write-result, write-over, write-error. Add `&lang=en` to force English.

import type * as T from "./types";

const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
export const scene = params.get("scene") ?? "voice";

/** The mock's opinion of how a screen should start; null in real builds. */
export function mockScene(): string | null {
  return import.meta.env.VITE_LITA_MOCK ? scene : null;
}

const never = <T,>() => new Promise<T>(() => {});
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const profile: T.VoiceProfile = {
  language: "ja",
  first_person: "私",
  formality: "常体",
  tone: ["分析的", "懐疑的"],
  sentence_endings: ["のだろうか。", "と思う。", "ではないか。"],
  avg_sentence_length_chars: 42,
  preferred_words: ["エクイティ", "ファイナンス", "構造"],
  avoided_words: ["絶対", "最強"],
  opens_with: "問いから入る",
  closes_with: "含みを残して締める",
  uses_emoji: false,
  representative_excerpts: [
    { excerpt: "資本政策は、何を諦めるかを先に決める作業なのだろうか。", why: "問いで締める癖が出ている" },
    { excerpt: "ファイナンスの話は結局、時間をどう買うかに帰着すると思う。", why: "抽象化して言い切る" },
  ],
};

const sources: T.VoiceSource[] = [1, 2, 3, 4].map((i) => ({
  id: `s${i}`, kind: "note", origin: `https://note.com/kuno/n/n${i}`,
  body: "資本政策は、何を諦めるかを先に決める作業なのだろうか。".repeat(8), created_at: "2026-09-22T09:00:00Z",
}));

let voice: T.Voice = {
  id: "v1", name: "test", profile, created_at: "2026-09-22T09:00:00Z", updated_at: "2026-09-22T09:00:00Z", voice_sources: sources,
};

const pieces: T.Piece[] = Array.from({ length: 5 }, (_, i) => ({
  title: ["資本政策は諦める順番を決める作業", "ファイナンスは時間を買う話", "エクイティの重さについて", "投資家との最初の会話で聞くこと", "利益率の議論が空回りする理由"][i],
  url: `https://note.com/kuno/n/n${i + 1}`, published_at: "2026-09-01",
  text: "資本政策は、何を諦めるかを先に決める作業なのだろうか。ファイナンスの話は結局、時間をどう買うかに帰着すると思う。".repeat(6 + i),
}));

const draftBody = "資本政策の相談で最初に聞くのは、いくら欲しいかではなく、何を諦められるかだ。エクイティは返さなくていい金ではなく、時間と自由を先に売る契約なのだろうか。";
const longBody = draftBody + "ファイナンスの選択肢を並べる前に、まず自分が手放せないものを一つ決める。そこから逆算すると、借入か出資かの答えはほとんど決まっていると思う。それでも迷うなら、迷っている理由の方が本題ではないか。";

const codex: T.CodexStatus =
  scene === "codex-not-logged-in" ? { status: "not_logged_in", version: "0.154.0" }
  : scene === "codex-not-installed" ? { status: "not_installed" }
  : { status: "ready", version: "0.154.0" };

const session: T.SessionStatus =
  scene === "signed-out" ? { status: "signed_out" } : { status: "signed_in", email: "kuno@muumoo.online" };

const hasVoice = !["intake", "intake-loaded", "building"].includes(scene);

export const mockHost: T.Host = {
  codexStatus: async () => codex,
  sessionStatus: async () => session,
  signIn: () => (scene === "signing-in" ? never() : Promise.resolve<T.SessionStatus>({ status: "signed_in", email: "kuno@muumoo.online" })),
  cancelSignIn: async () => {},
  signOut: async () => ({ status: "signed_out" }),
  listVoices: async () => (hasVoice ? [{ id: voice.id, name: voice.name, created_at: voice.created_at, updated_at: voice.updated_at, source_count: sources.length }] : []),
  getVoice: async () => voice,
  deleteVoice: async () => true,
  renameVoice: async (_id, name) => { voice = { ...voice, name }; },
  updateVoiceProfile: async (_id, profile) => (voice = { ...voice, profile }),
  createVoice: () => never(),
  cancelVoiceBuild: async () => {},
  materialBudget: async () => ({ per_piece_chars: 1500, total_chars: 20000 }),
  platforms: async () => [{ id: "x", name: "X", max_chars: 280, rules: "" }],
  previewPrompt: async (_v, brief) => `You are writing as the author described below.\n\nVoice:\n${JSON.stringify(profile, null, 2)}\n\nBrief:\n${brief}\n\nPlatform: X (280 chars)`,
  generateDraft: async () => {
    if (scene === "write-generating") return never();
    if (scene === "write-error") { await wait(300); throw { code: "codex_quota", detail: "stream error: quota exceeded (429)" }; }
    await wait(300);
    const body = scene === "write-over" ? longBody : draftBody;
    return {
      draft: { id: "d1", brief_id: "b1", body, prompt_sent: "", model: null, elapsed_ms: 6600, status: "pending", created_at: new Date().toISOString(), decided_at: null },
      voice_notes: "常体で、問いで締める癖と「エクイティ」「ファイナンス」を使った。",
    };
  },
  cancelGenerate: async () => {},
  setDraftStatus: async () => {},
  copyText: async () => {},
  importNote: async () => { await wait(300); return { pieces, total: 12, skipped_paid: 1, recent_only: false }; },
  importMedium: async () => { await wait(300); return { pieces, total: null, skipped_paid: 0, recent_only: true }; },
  importXArchive: async () => { await wait(300); return { pieces, total: null, skipped_paid: 0, recent_only: false }; },
  onVoiceProgress: async (handler) => {
    const stages: T.VoiceProgress["stage"][] = ["thinking", "extracted"];
    const timers = stages.map((stage, i) => setTimeout(() => handler({ stage }), 800 * (i + 1)));
    return () => timers.forEach(clearTimeout);
  },
  openExternal: async () => {},
};
