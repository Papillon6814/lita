// An in-browser stand-in for the native side, used only when the app is
// built with VITE_LITA_MOCK=1 (see `npm run mock`). It lets every screen be
// opened in an ordinary browser, which is how design reviews take their
// screenshots. The scene comes from the URL: `?scene=voice`, `?scene=write`…
//
// Scenes: signed-out, signing-in, codex-not-logged-in, codex-not-installed,
// intake, intake-loaded, building, voice, voice-open, voice-template (older
// profile without one_line), articles, articles-empty, editor, editor-empty,
// editor-generating, editor-over, editor-save-failed, editor-versions, editor-note, write, write-generating,
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
  one_line: scene === "voice-template" ? "" : "あなたの文章は、常体で分析的。エクイティやファイナンスを軸に問いを立て、「のだろうか」と含みを残して締める。",
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
const longBody = draftBody + "資本政策の話は、結局のところ何を諦めるかの順番を決める作業でしかないのだろうか。" + "ファイナンスの選択肢を並べる前に、まず自分が手放せないものを一つ決める。そこから逆算すると、借入か出資かの答えはほとんど決まっていると思う。それでも迷うなら、迷っている理由の方が本題ではないか。" + "ファイナンスの選択肢を並べる前に、まず自分が手放せないものを一つ決める。そこから逆算すると、借入か出資かの答えはほとんど決まっていると思う。それでも迷うなら、迷っている理由の方が本題ではないか。";

const codex: T.CodexStatus =
  scene === "codex-not-logged-in" ? { status: "not_logged_in", version: "0.154.0" }
  : scene === "codex-not-installed" ? { status: "not_installed" }
  : { status: "ready", version: "0.154.0" };

const session: T.SessionStatus =
  scene === "signed-out" ? { status: "signed_out" } : { status: "signed_in", email: "kuno@muumoo.online" };

const hasVoice = !["intake", "intake-loaded", "building"].includes(scene);

// ----- articles (in-memory) -------------------------------------------------

const now = new Date();
const ago = (mins: number) => new Date(now.getTime() - mins * 60000).toISOString();
const articleBodies = [
  { title: "資本政策は諦める順番を決める作業", body: draftBody, brief: "資本政策の相談を受けたときに最初に聞くことについて。創業者に向けて、エクイティは時間を売る契約だと伝えたい。", platform: "x", status: "approved", at: ago(35) },
  { title: "", body: scene === "editor-over" ? longBody : (scene === "editor-empty" ? "" : draftBody), brief: scene === "editor-empty" ? "" : "利益率の議論が空回りする理由について、経営者向けに。分母を揃える話を一つだけ。", platform: "x", status: "draft", at: ago(3) },
  { title: "投資家との最初の会話で聞くこと", body: "投資家との最初の会話で聞くべきことは一つで、彼らが何を恐れているかだ。\n\nリターンの話は後からいくらでもできる。恐れが分かれば、こちらの提案の形はほとんど決まる。\n\n## 恐れは三つに分かれる\n\n一つ目は時間、二つ目は評判、三つ目は次の資金調達だ。", brief: "投資家との初回面談で何を聞くべきか。note 向けに 1,500 字ほど。", platform: "note", status: "draft", at: ago(60 * 26) },
  { title: "ファイナンスは時間を買う話", body: draftBody, brief: "ファイナンスの選択肢の話。", platform: "x", status: "archived", at: ago(60 * 24 * 4) },
];
const articles: T.Article[] = scene === "articles-empty" ? [] : articleBodies.map((a, i) => ({
  id: `a${i + 1}`, voice_id: "v1", platform_id: a.platform, title: a.title, body: a.body, brief: a.brief,
  status: a.status as T.ArticleStatus, created_at: a.at, updated_at: a.at,
}));
// The editor scenes open a2 (a draft with a brief).
if (scene.startsWith("editor")) { const a = articles.find((x) => x.id === (scene === "editor-note" ? "a3" : "a2")); if (a) { articles.splice(articles.indexOf(a), 1); articles.unshift({ ...a, id: "a1" }); articles[1] = { ...articles[1], id: "a2" }; } }
const versions: T.ArticleVersion[] = scene === "editor-versions" ? [
  { id: "v3", article_id: "a1", kind: "edited", title: "", body: draftBody, prompt_sent: null, elapsed_ms: null, created_at: ago(3) },
  { id: "v2", article_id: "a1", kind: "shortened", title: "", body: draftBody, prompt_sent: "…", elapsed_ms: 6000, created_at: ago(25) },
  { id: "v1", article_id: "a1", kind: "generated", title: "", body: draftBody + "資本政策の話は、結局のところ何を諦めるかの順番を決める作業でしかないのだろうか。", prompt_sent: "…", elapsed_ms: 6600, created_at: ago(40) },
] : [];
let nextId = 100;
const excerpt = (b: string) => (b.trim().split("\n").find((l) => l.trim()) ?? "").slice(0, 80);

export const mockHost: T.Host = {
  listArticles: async (status) => articles.filter((a) => !status || a.status === status).map(({ body, ...a }) => ({ ...a, excerpt: excerpt(body) })),
  getArticle: async (id) => articles.find((a) => a.id === id) ?? null,
  createArticle: async (platformId, voiceId) => {
    const a: T.Article = { id: `a${nextId++}`, voice_id: voiceId ?? "v1", platform_id: platformId ?? "x", title: "", body: "", brief: "", status: "draft", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    articles.unshift(a); return a;
  },
  updateArticle: async (id, patch) => {
    if (scene === "editor-save-failed") throw { code: "network", detail: "fetch failed: ENOTFOUND csfvqpqzvcorqlsmfjwb.supabase.co" };
    const a = articles.find((x) => x.id === id); if (a) Object.assign(a, patch, { updated_at: new Date().toISOString() });
  },
  deleteArticle: async (id) => { const i = articles.findIndex((a) => a.id === id); if (i >= 0) articles.splice(i, 1); return i >= 0; },
  listVersions: async (articleId) => versions.filter((v) => v.article_id === articleId),
  snapshotArticle: async (articleId, manual) => {
    const a = articles.find((x) => x.id === articleId); if (!a) return null;
    const v: T.ArticleVersion = { id: `v${nextId++}`, article_id: articleId, kind: manual ? "manual" : "edited", title: a.title, body: a.body, prompt_sent: null, elapsed_ms: null, created_at: new Date().toISOString() };
    versions.unshift(v); return v;
  },
  restoreVersion: async (versionId) => {
    const v = versions.find((x) => x.id === versionId)!; const a = articles.find((x) => x.id === v.article_id)!;
    Object.assign(a, { title: v.title, body: v.body }); return a;
  },
  generateIntoArticle: async (articleId, _effort, previous) => {
    if (scene === "editor-generating") return never();
    await wait(400);
    const a = articles.find((x) => x.id === articleId)!;
    a.body = previous ? draftBody : (a.platform_id === "x" ? draftBody : longBody);
    if (a.platform_id !== "x" && !a.title) a.title = "資本政策は諦める順番を決める作業";
    const v: T.ArticleVersion = { id: `v${nextId++}`, article_id: articleId, kind: previous ? "shortened" : "generated", title: a.title, body: a.body, prompt_sent: "…", elapsed_ms: 6600, created_at: new Date().toISOString() };
    versions.unshift(v);
    return { article: { ...a }, version: v, voice_notes: "常体で、問いで締める癖と「エクイティ」「ファイナンス」を使った。" };
  },
  getSettings: async () => ({ default_voice_id: "v1" }),
  setDefaultVoice: async () => {},
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
  platforms: async () => [{ id: "medium", name: "Medium", max_chars: null, rules: "" }, { id: "note", name: "note", max_chars: null, rules: "" }, { id: "x", name: "X", max_chars: 280, rules: "" }],
  previewPrompt: async (_v, brief) => `You are writing as the author described below.\n\nVoice:\n${JSON.stringify(profile, null, 2)}\n\nBrief:\n${brief}\n\nPlatform: X (280 chars)`,
  generateDraft: async (_v, _b, _p, _e, previous) => {
    if (scene === "write-generating") return never();
    if (previous) { await wait(300); return { draft: { id: "d2", brief_id: "b1", body: draftBody, prompt_sent: "", model: null, elapsed_ms: 6000, status: "pending", created_at: new Date().toISOString(), decided_at: null }, voice_notes: "前の下書きを削って収めた。" }; }
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
