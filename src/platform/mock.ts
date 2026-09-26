// An in-browser stand-in for the native side, used only when the app is
// built with VITE_LITA_MOCK=1 (see `npm run mock`). It lets every screen be
// opened in an ordinary browser, which is how design reviews take their
// screenshots. The scene comes from the URL: `?scene=voice`, `?scene=write`…
//
// Scenes: launch (waiting on the sign-in), launch-slow (waiting on Codex,
// past three seconds), signed-out, signing-in, codex-not-logged-in, codex-not-installed,
// intake, intake-open (note row unfolded), intake-connecting (note import
// running, never finishing), intake-loaded, intake-manual (three pieces
// pasted by hand), intake-both (one pasted piece plus a note import),
// building, voice,
// voice-open (same as voice: the eight items are no longer folded),
// voice-evidence (one row's quotes already open),
// intake-preset (the intake with the road to the voice that comes with
// Lita in view; the same screen as intake, kept as its own name so the
// screenshot has one), voice-preset (that voice, just made: no writing
// behind it yet),
// voice-sources (mixed connections), voice-template (older
// profile without one_line), voices (two voices), articles-first-run,
// update-available, update-downloading, update-latest, articles, articles-empty, editor, editor-empty,
// editor-generating, editor-over, editor-save-failed, editor-versions, editor-note,
// editor-brief-suggesting (Lita is working out what to write),
// editor-brief-suggested (the suggestion has just landed, with a way back),
// editor-generating-long (writing a note article, where the wait is minutes),
// write, write-generating,
// write-result, write-over, write-error,
// topics (picking titles, policy empty, the cloud already gathered),
// topics-picked (two words pressed, ten titles, three picked, policy filled),
// topics-picked-few (ten titles, three picked, no cloud to press),
// topics-policy-open (the policy opened, all three lines empty),
// topics-policy-open-filled (the policy opened, filled),
// topics-cloud-first (no cloud yet, gathering it on open, never finishing),
// topics-cloud-picked (three words pressed), topics-cloud-more (more
// material since the cloud was gathered), topics-cloud-few (too few words
// to make a cloud: no cloud and no sentence in its place), topics-cloud-failed (gathering did not work),
// articles-queued (one writing, two waiting),
// articles-queue-failed (one written, one not written, one waiting, and the
// whole thing stopped). Add `&lang=en` to force English.
// `&delay=<ms>` slows every read (the lists, one article, one voice), so the
// loading rules can be watched: under 300 ms nothing is said at all.

import type * as T from "./types";

const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
export const scene = params.get("scene") ?? "voice";

/** The mock's opinion of how a screen should start; null in real builds. */
export function mockScene(): string | null {
  return import.meta.env.VITE_LITA_MOCK ? scene : null;
}

const never = <T,>() => new Promise<T>(() => {});
const noteName = scene === "voices" ? "note・kuno" : "test";
const wait = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

/** `?delay=800` makes every read that slow, to watch the loading rules. */
const readDelay = Math.max(0, Number(params.get("delay") ?? "0")) || 0;

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

// The stricter reading (2026-09-23): quotes behind each item, and how sure it
// is. `voice-template` keeps the old shape, so the screen shows nothing extra.
const strict: Partial<T.VoiceProfile> = {
  rhetoric: "言い直して畳みかけ、最後に逆接を一つ置く",
  examples_and_numbers: "自分が立ち会った場面を出し、数字は概数で置く",
  kana_choices: ["できる", "こと", "ほとんど"],
  never_does: ["感嘆符を使わない", "読者に呼びかけない", "体言止めをしない"],
  word_usage: [
    { word: "エクイティ", usage: "「借りる」と対にして、返さない代わりに何を渡すかの話に使う" },
    { word: "構造", usage: "個人の努力の話を、仕組みの話に引き取るときに使う" },
  ],
  topic_words: ["資本政策", "投資家"],
  backing: {
    preferred_words: { confidence: "high", evidence: [
      { piece: 0, quote: "エクイティは返さなくていい金ではなく、時間と自由を先に売る契約だ。" },
      { piece: 1, quote: "ファイナンスの話は結局、時間をどう買うかに帰着すると思う。" },
      { piece: 2, quote: "努力の差に見えるものは、たいてい構造の差だ。" },
    ] },
    avoided_words: { confidence: "low", evidence: [
      { piece: 0, quote: "絶対に正しい資本政策というものは、たぶん無い。" },
    ] },
    first_person: { confidence: "high", evidence: [
      { piece: 0, quote: "私はこの質問を、相談の最初に必ず置く。" },
      { piece: 3, quote: "私が見てきた範囲では、ここで迷う人がいちばん多い。" },
    ] },
    formality: { confidence: "high", evidence: [
      { piece: 1, quote: "資本政策は、何を諦めるかを先に決める作業だ。" },
    ] },
    tone: { confidence: "medium", evidence: [
      { piece: 2, quote: "その数字は、本当に比べられるものを比べているのだろうか。" },
    ] },
    sentence_endings: { confidence: "high", evidence: [
      { piece: 0, quote: "迷っている理由の方が本題ではないか。" },
      { piece: 1, quote: "時間をどう買うかに帰着すると思う。" },
    ] },
    opens_with: { confidence: "medium", evidence: [
      { piece: 3, quote: "いくら欲しいか、と聞かれて答えられる人は少ない。" },
    ] },
    closes_with: { confidence: "medium", evidence: [
      { piece: 0, quote: "先に売る契約なのだろうか。" },
    ] },
    rhetoric: { confidence: "medium", evidence: [
      { piece: 2, quote: "順番の問題だ。順番だけの問題だ。それでも順番は決まらない。" },
    ] },
    examples_and_numbers: { confidence: "medium", evidence: [
      { piece: 3, quote: "十人ほど見てきたが、最初の一回で決められた人はいない。" },
    ] },
    kana_choices: { confidence: "high", evidence: [
      { piece: 1, quote: "ここで決めることは、ほとんど決まっていると思う。" },
    ] },
    never_does: { confidence: "medium", evidence: [
      { piece: 2, quote: "答えはほとんど決まっていると思う。" },
    ] },
  },
};

// The voice that comes with Lita (D-70): written by hand, copied as it is.
// No backing, no quotes, no measurements — there is no writing behind it,
// and that is a normal state, not a fault.
const PRESET_ONE_LINE = "あなたの文章は、です・ます調で平易に、要点を先に言い、読者への一つのお願いで静かに締めます。";
const presetProfile: T.VoiceProfile = {
  language: "ja",
  first_person: "私たち",
  formality: "です・ます調",
  tone: ["丁寧", "平易"],
  sentence_endings: ["です。", "ます。", "ません。"],
  avg_sentence_length_chars: 38,
  preferred_words: ["お知らせします", "ご案内します", "たとえば"],
  avoided_words: ["弊社", "させていただく", "業界初"],
  opens_with: "要点を先に一文で言う",
  closes_with: "読者への一つのお願いで締める",
  uses_emoji: false,
  representative_excerpts: [],
  one_line: PRESET_ONE_LINE,
};
const presetVoice: T.Voice = {
  id: "v-preset", name: "広報のです・ます", profile: presetProfile,
  created_at: "2026-09-24T02:00:00Z", updated_at: "2026-09-24T02:00:00Z", voice_sources: [],
};

const sources: T.VoiceSource[] = [1, 2, 3, 4].map((i) => ({
  id: `s${i}`, kind: "note", origin: `https://note.com/kuno/n/n${i}`, account: "kuno",
  body: "資本政策は、何を諦めるかを先に決める作業なのだろうか。".repeat(8), created_at: "2026-09-22T09:00:00Z",
}));

const voice2: T.Voice = {
  id: "v2", name: "貼った文章", profile: { ...profile, formality: "です・ます調", tone: ["落ち着いた", "丁寧"], sentence_endings: ["と思います。", "ではないでしょうか。"], one_line: "あなたの文章は、です・ます調で落ち着いて丁寧。「ではないでしょうか」と問いかけて締める。" },
  created_at: "2026-09-23T01:00:00Z", updated_at: "2026-09-23T01:00:00Z", voice_sources: sources.slice(0, 2),
};
const handBodies = [
  "エクイティは返さなくていい金ではなく、いちばん高い金です。返済期限がないぶん、会社の持ち分を削ります。",
  "買収の相談で最初に聞くのは値段ではありません。売り手が何を手放したくないか、です。",
  "小さな会社の資金繰りは、月末ではなく週で見ます。遅れている入金と、動かせる支払いが分けて見えます。",
];
const mixedSources: T.VoiceSource[] = [
  ...sources,
  { id: "m1", kind: "medium", origin: "https://medium.com/@kuno/a", account: "kuno", body: "…", created_at: "2026-09-23T02:00:00Z" },
  { id: "m2", kind: "medium", origin: "https://medium.com/@kuno/b", account: "kuno", body: "…", created_at: "2026-09-23T02:00:00Z" },
  ...handBodies.map((body, i) => ({ id: `p${i + 1}`, kind: "paste" as const, origin: null, account: null, body, created_at: "2026-09-23T02:30:00Z" })),
];
let voice: T.Voice = {
  id: "v1", name: noteName, profile: scene === "voice-template" ? profile : { ...profile, ...strict }, created_at: "2026-09-22T09:00:00Z", updated_at: "2026-09-22T09:00:00Z", voice_sources: scene === "voice-sources" ? mixedSources : sources,
};

if (scene === "voice-preset") voice = presetVoice;

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

let hasVoice = !["intake", "intake-preset", "intake-open", "intake-connecting", "intake-loaded", "intake-manual", "intake-both", "building", "articles-first-run", "articles-no-voice", "topics-no-voice"].includes(scene);

// ----- articles (in-memory) -------------------------------------------------

const now = new Date();
const ago = (mins: number) => new Date(now.getTime() - mins * 60000).toISOString();
const articleBodies = [
  { title: "資本政策は諦める順番を決める作業", body: draftBody, brief: "資本政策の相談を受けたときに最初に聞くことについて。創業者に向けて、エクイティは時間を売る契約だと伝えたい。", platform: "x", status: "approved", at: ago(35) },
  { title: scene.startsWith("editor-brief") ? "利益率の議論が空回りする理由" : "", body: scene === "editor-over" ? longBody : (scene === "editor-empty" ? "" : draftBody), brief: scene === "editor-empty" ? "" : (scene.startsWith("editor-brief") ? "利益率の議論が空回りする理由について、経営者向けに。分母を揃える話を一つだけ。\n長さは 1,500〜3,000 字。\n外部の事実は調べず、自分の経験と意見の範囲で書く。" : "利益率の議論が空回りする理由について、経営者向けに。分母を揃える話を一つだけ。"), platform: "x", status: "draft", at: ago(3) },
  { title: "投資家との最初の会話で聞くこと", body: "投資家との最初の会話で聞くべきことは一つで、彼らが何を恐れているかだ。\n\nリターンの話は後からいくらでもできる。恐れが分かれば、こちらの提案の形はほとんど決まる。\n\n## 恐れは三つに分かれる\n\n一つ目は時間、二つ目は評判、三つ目は次の資金調達だ。", brief: "投資家との初回面談で何を聞くべきか。note 向けに 1,500 字ほど。", platform: "note", status: "draft", at: ago(60 * 26) },
  { title: "ファイナンスは時間を買う話", body: draftBody, brief: "ファイナンスの選択肢の話。", platform: "x", status: "archived", at: ago(60 * 24 * 4) },
];
const articles: T.Article[] = scene === "articles-empty" || scene === "articles-first-run" ? [] : articleBodies.map((a, i) => ({
  id: `a${i + 1}`, voice_id: "v1", platform_id: a.platform, title: a.title, body: a.body, brief: a.brief,
  status: a.status as T.ArticleStatus, queue: null, created_at: a.at, updated_at: a.at,
}));
// The editor scenes open a2 (a draft with a brief).
if (scene.startsWith("editor")) { const a = articles.find((x) => x.id === (scene === "editor-note" || scene === "editor-generating-long" ? "a3" : "a2")); if (a) { articles.splice(articles.indexOf(a), 1); articles.unshift({ ...a, id: "a1" }); articles[1] = { ...articles[1], id: "a2" }; } }

// ----- the queue (article-queue, 2026-09-23) --------------------------------

// The two article-list scenes hold still so a screenshot catches them; the
// queue only really moves when titles are lined up in this session.
const frozen = scene === "articles-queued" || scene === "articles-queue-failed";
const queuedTitles = ["借入とエクイティ、どちらが高い金か", "資金繰りは月ではなく週で見る", "撤退の基準は、始める前に決める"];
if (frozen) {
  const failed = scene === "articles-queue-failed";
  const states: (T.QueueState | null)[] = failed ? [null, "failed", "waiting"] : ["writing", "waiting", "waiting"];
  articles.unshift(...queuedTitles.map((title, i) => ({
    id: `q${i + 1}`, voice_id: "v1", platform_id: "note", title,
    body: failed && i === 0 ? "返さなくていい金が、いちばん高い金になることがあります。" : "",
    brief: "返さない金の方が高くつく、という話を一本。", status: "draft" as T.ArticleStatus,
    queue: states[i], created_at: ago(i), updated_at: ago(i),
  })));
}

const emptyPolicy: T.Policy = { audience: "", takeaway: "", topics: [], avoid: "" };
const fullPolicy: T.Policy = {
  audience: "これから会社を買う経営者",
  takeaway: "値段より先に見るものがある",
  topics: ["資金繰り", "買収", "採用"],
  avoid: "個別の会社名",
};
let policy: T.Policy = ["topics-picked", "topics-cloud-picked", "topics-policy-open-filled"].includes(scene) ? fullPolicy : emptyPolicy;

// The words someone keeps writing about (2026-09-24). `weight` is 1–5 and is
// folded into three sizes on screen; `written` marks a subject already used
// as a title. Thirty-six words, the middle of the 20–40 the gatherer returns.
const cloudWords: T.CloudWord[] = ([
  ["在庫", 1, false], ["契約書", 2, false], ["顧問", 1, true], ["粗利", 3, false], ["月次", 2, false],
  ["人件費", 3, false], ["事業承継", 3, false], ["銀行", 3, false], ["資金繰り", 5, false],
  ["値付け", 3, false], ["のれん", 3, true], ["買収", 5, false], ["借入", 3, false],
  ["売り手", 3, false], ["数字の読み方", 3, false], ["採用", 5, false], ["権限委譲", 3, false],
  ["撤退基準", 3, false], ["資本政策", 3, true], ["現場", 3, false], ["定着", 3, false],
  ["社長の時間", 3, false], ["評価", 3, false], ["投資家", 3, true], ["会議", 1, false],
  ["経営計画", 3, false], ["引き継ぎ", 2, false], ["税務", 1, false], ["キャッシュ", 3, false],
  ["組織", 3, false], ["給与", 2, false], ["独立", 1, false], ["小さな会社", 4, false],
  ["業界構造", 2, false], ["デューデリジェンス", 2, false], ["ミドルマネジメント", 1, false],
] as [string, number, boolean][]).map(([word, weight, written]) => ({ word, weight, written }));

const fullCloud: T.TopicCloud = { words: cloudWords, gathered_at: ago(2), material_count: 18 };
// Under five words is not a cloud; the screen says so in one line instead.
const sparseCloud: T.TopicCloud = { words: cloudWords.slice(0, 3), gathered_at: ago(2), material_count: 2 };

const cloudView = (): T.CloudView => {
  if (!scene.startsWith("topics")) return { cloud: null, material_count: 0 };
  if (scene === "topics-cloud-first") return { cloud: null, material_count: 18 };
  if (scene === "topics-cloud-few" || scene === "topics-picked-few") return { cloud: sparseCloud, material_count: 2 };
  if (scene === "topics-cloud-failed") return { cloud: null, material_count: 18 };
  // More material than the cloud was gathered from: one quiet line offers to
  // gather again, and never says how many more.
  if (scene === "topics-cloud-more") return { cloud: fullCloud, material_count: 24 };
  return { cloud: fullCloud, material_count: 18 };
};

const topicRounds = [
  [
    "借入とエクイティ、どちらが高い金か",
    "値付けの前に、売り手が手放したくないもの",
    "資金繰りは月ではなく週で見る",
    "小さな会社の採用は、席ではなく仕事で決める",
    "当たらない前提で事業計画を作る",
    "のれんの話を、経営の言葉に直す",
    "社長が数字を読めるようになる順番",
    "撤退の基準は、始める前に決める",
    "銀行との面談で、先に出す一枚",
    "買収の後、最初の 90 日でしないこと",
  ],
  [
    "引き継ぎの三か月で、先に壊すもの",
    "月次が出るのが遅い会社に共通すること",
    "面接で聞かない方がいい質問",
    "値引きを断る言い方を先に決めておく",
    "社長が現場を離れる順番",
    "在庫は、決算より先に人を縛る",
    "digital でない会社の digital 化",
    "報酬の決め方を、先に紙に書く",
    "仕入先を一社に寄せたときに起きたこと",
    "辞めた人の穴を、採用で埋めない",
  ],
];
let topicRound = 0;

// What ten titles look like once words have been pressed: every one of them
// is about the subjects that were picked.
const subjectTitles = [
  "小さな会社の採用は、席ではなく仕事で決める",
  "入社 3 か月で辞める人と、辞めない人の差",
  "求人票に書けないことを、面接で先に言う",
  "評価は、上げる理由より下げない理由で書く",
  "採用の前に、いまの人の仕事を一つ減らす",
  "給与を上げる前に、決める順番がある",
  "定着しない職場に共通する、朝の 10 分",
  "未経験を採るなら、教える人の時間を先に空ける",
  "社長が面接に出るのをやめる日",
  "辞めた人の理由は、辞める前に聞ける",
];

const queueHandlers = new Set<(e: T.QueueEvent) => void>();
const emitQueue = (e: T.QueueEvent) => queueHandlers.forEach((h) => h(e));
let queueTimer: number | undefined;

// One at a time, in the order they were lined up (which is the order they
// sit in the list).
function stepQueue() {
  if (frozen || queueTimer !== undefined) return;
  const target = articles.find((a) => a.queue === "writing") ?? articles.find((a) => a.queue === "waiting");
  if (!target) return;
  target.queue = "writing";
  emitQueue({ kind: "changed" });
  queueTimer = window.setTimeout(() => {
    queueTimer = undefined;
    target.body = longBody;
    target.queue = null;
    target.updated_at = new Date().toISOString();
    emitQueue({ kind: "changed" });
    stepQueue();
  }, 3000);
}

const versions: T.ArticleVersion[] = scene === "editor-versions" ? [
  { id: "v3", article_id: "a1", kind: "edited", title: "", body: draftBody, prompt_sent: null, elapsed_ms: null, created_at: ago(3) },
  { id: "v2", article_id: "a1", kind: "shortened", title: "", body: draftBody, prompt_sent: "…", elapsed_ms: 6000, created_at: ago(25) },
  { id: "v1", article_id: "a1", kind: "generated", title: "", body: draftBody + "資本政策の話は、結局のところ何を諦めるかの順番を決める作業でしかないのだろうか。", prompt_sent: "…", elapsed_ms: 6600, created_at: ago(40) },
] : [];
let nextId = 100;
const excerpt = (b: string) => (b.trim().split("\n").find((l) => l.trim()) ?? "").slice(0, 80);

// Listeners for import-progress, as the native side has; importNote feeds them.
const importHandlers = new Set<(p: T.ImportProgress) => void>();
const emitImport = (p: T.ImportProgress) => importHandlers.forEach((h) => h(p));

export const mockHost: T.Host = {
  listArticles: async (status) => { await wait(readDelay); return articles.filter((a) => !status || a.status === status).map(({ body, ...a }) => ({ ...a, excerpt: excerpt(body) })); },
  getArticle: async (id) => { await wait(readDelay); return articles.find((a) => a.id === id) ?? null; },
  createArticle: async (platformId, voiceId) => {
    // An empty draft is handed back instead of a second one (#93).
    const empty = articles.filter((x) => x.status === "draft" && !x.title && !x.body && !x.brief && !x.queue);
    if (empty.length > 0) { for (const e of empty.slice(1)) articles.splice(articles.indexOf(e), 1); return empty[0]; }
    const a: T.Article = { id: `a${nextId++}`, voice_id: voiceId ?? "v1", platform_id: platformId ?? "x", title: "", body: "", brief: "", status: "draft", queue: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
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
    if (scene === "editor-generating" || scene === "editor-generating-long") return never();
    await wait(400);
    const a = articles.find((x) => x.id === articleId)!;
    a.body = previous ? draftBody : (a.platform_id === "x" ? draftBody : longBody);
    if (a.platform_id !== "x" && !a.title) a.title = "資本政策は諦める順番を決める作業";
    const v: T.ArticleVersion = { id: `v${nextId++}`, article_id: articleId, kind: previous ? "shortened" : "generated", title: a.title, body: a.body, prompt_sent: "…", elapsed_ms: 6600, created_at: new Date().toISOString() };
    versions.unshift(v);
    return { article: { ...a }, version: v, voice_notes: "常体で、問いで締める癖と「エクイティ」「ファイナンス」を使った。" };
  },
  // A brief written from the title (never saved). The native side takes ten
  // to twenty seconds; here one second is enough to see the waiting face.
  suggestBrief: async (articleId) => {
    if (scene === "editor-brief-suggesting") return never();
    await wait(readDelay || 1000);
    const a = articles.find((x) => x.id === articleId);
    const title = a?.title.trim() || "この題";
    return `「${title}」について、数字の話に入る前に前提を揃える一本です。自分で売上や利益を見ている経営者に向けて書きます。同じ利益率でも分母の取り方で意味が変わること、そして自分の会社では何を分母にすべきかを、手元の例で示します。読み終えたあとに、自社の数字を一度だけ計算し直したくなる形にします。`;
  },
  getPolicy: async () => policy,
  setPolicy: async (p) => { policy = p; },
  // The editorial policy no longer carries what you often write about; the
  // cloud does (D-66), so the draft leaves that field empty.
  draftPolicy: async () => { await wait(1200); return { ...fullPolicy, topics: [] }; },
  getTopicCloud: async () => { await wait(readDelay); return cloudView(); },
  gatherTopicCloud: async () => {
    // The first-run scene stays on the gathering line, so the quiet wait and
    // the way out of it can be seen.
    if (scene === "topics-cloud-first") return never();
    if (scene === "topics-cloud-failed") { await wait(readDelay || 800); throw { code: "codex_failed", detail: "topic cloud: empty response" }; }
    await wait(readDelay || 1500);
    return { cloud: { ...fullCloud, material_count: cloudView().material_count }, material_count: cloudView().material_count };
  },
  suggestTopics: async (subjects, _direction) => {
    await wait(scene.startsWith("topics-picked") ? 200 : 1200);
    // Picked words steer the titles, so they are visibly about those subjects.
    const list = subjects.length > 0 ? subjectTitles : topicRounds[topicRound % topicRounds.length];
    if (subjects.length === 0) topicRound += 1;
    const taken = new Set(articles.map((a) => a.title.trim()));
    return list.filter((t) => !taken.has(t));
  },
  enqueueArticles: async (titles, voiceId, platformId, _effort, subjects, direction) => {
    // The subject and the angle stay on separate lines, so neither reads as
    // the other (requirement 12–13).
    const brief = [
      policy.audience && `誰に向けて: ${policy.audience}`,
      policy.takeaway && `持ち帰ってほしいこと: ${policy.takeaway}`,
      policy.avoid && `触れないこと: ${policy.avoid}`,
      subjects.length > 0 && `題材: ${subjects.join("、")}`,
      direction.trim() && `今回の方向: ${direction.trim()}`,
      "長さは 1,500〜3,000 字。",
      "外部の事実は調べず、自分の経験と意見の範囲で書く。数字や出来事は断定しない。",
    ].filter(Boolean).join("\n");
    const made: T.Article[] = titles.map((title, i) => ({
      id: `q${nextId++}`, voice_id: voiceId, platform_id: platformId, title, body: "", brief,
      status: "draft" as T.ArticleStatus, queue: "waiting" as T.QueueState,
      created_at: new Date(Date.now() - i).toISOString(), updated_at: new Date(Date.now() - i).toISOString(),
    }));
    [...made].reverse().forEach((a) => articles.unshift(a));
    stepQueue();
    return made.map(({ body, ...a }) => ({ ...a, excerpt: excerpt(body) }));
  },
  startQueue: async () => { stepQueue(); },
  dequeueArticle: async (id) => {
    const i = articles.findIndex((a) => a.id === id);
    if (i < 0) return;
    if (articles[i].queue === "writing") {
      if (queueTimer !== undefined) { window.clearTimeout(queueTimer); queueTimer = undefined; }
      articles[i].queue = null;
    } else {
      articles.splice(i, 1);
    }
    emitQueue({ kind: "changed" });
    stepQueue();
  },
  clearQueue: async () => {
    if (queueTimer !== undefined) { window.clearTimeout(queueTimer); queueTimer = undefined; }
    for (let i = articles.length - 1; i >= 0; i--) {
      if (articles[i].queue === "waiting") articles.splice(i, 1);
      else if (articles[i].queue === "writing") articles[i].queue = null;
    }
    emitQueue({ kind: "changed" });
  },
  onQueueEvent: async (handler) => {
    queueHandlers.add(handler);
    const timer = scene === "articles-queue-failed"
      ? window.setTimeout(() => handler({ kind: "stopped", error: { code: "network", detail: "fetch failed: ENOTFOUND" } }), 150)
      : undefined;
    return () => { queueHandlers.delete(handler); if (timer !== undefined) window.clearTimeout(timer); };
  },
  appVersion: async () => "0.2.0",
  fetchUpdate: async () => {
    await wait(300);
    if (scene === "update-latest") return null;
    return { version: "0.3.0", current_version: "0.2.0", notes: "## Lita v0.3.0\n\n- 版履歴に差分表示\n- note の下書き保存", date: "2026-09-30T00:00:00Z" };
  },
  installUpdate: async (onEvent) => {
    onEvent({ event: "started", data: { content_length: 12_000_000 } });
    for (let i = 1; i <= (scene === "update-downloading" ? 4 : 10); i++) { await wait(150); onEvent({ event: "progress", data: { downloaded: i * 1_200_000, content_length: 12_000_000 } }); }
    if (scene === "update-downloading") return never();
    onEvent({ event: "finished", data: null });
  },
  restartApp: async () => {},
  onCheckUpdate: async () => () => {},
  // The launch scenes hold one of the two checks open so a screenshot catches
  // the launch screen: "launch" waits on the sign-in, "launch-slow" waits on
  // Codex long enough for the slow line to appear.
  codexStatus: async () => (scene === "launch-slow" ? never<T.CodexStatus>() : codex),
  sessionStatus: async () => (scene === "launch" ? never<T.SessionStatus>() : session),
  signIn: () => (scene === "signing-in" ? never() : Promise.resolve<T.SessionStatus>({ status: "signed_in", email: "kuno@muumoo.online" })),
  cancelSignIn: async () => {},
  signOut: async () => ({ status: "signed_out" }),
  listVoices: async () => { await wait(readDelay); return (hasVoice ? [{ id: voice.id, name: voice.name, created_at: voice.created_at, updated_at: voice.updated_at, source_count: voice.voice_sources.length }, ...(scene.startsWith("voices") ? [{ id: voice2.id, name: voice2.name, created_at: voice2.created_at, updated_at: voice2.updated_at, source_count: 2 }] : [])] : []); },
  getVoice: async (id) => { await wait(readDelay); return id === "v2" ? voice2 : voice; },
  deleteVoice: async () => true,
  renameVoice: async (_id, name) => { voice = { ...voice, name }; },
  updateVoiceProfile: async (_id, profile) => (voice = { ...voice, profile }),
  createVoice: () => never(),
  listVoicePresets: async () => [{ id: "pr-polite-ja", name: "広報のです・ます", one_line: PRESET_ONE_LINE }],
  createVoiceFromPreset: async (_id) => { voice = { ...presetVoice }; hasVoice = true; return voice; },
  addVoiceSources: async (_id, added) => { await wait(300); voice = { ...voice, voice_sources: [...voice.voice_sources, ...added.map((a, i) => ({ id: `n${i}`, kind: a.kind, origin: a.origin, account: a.account, body: a.body, created_at: new Date().toISOString() }))] }; return voice; },
  removeVoiceSource: async (_id, sourceId) => { voice = { ...voice, voice_sources: voice.voice_sources.filter((s) => s.id !== sourceId) }; return voice; },
  removeVoiceSources: async (_id, kind, account) => { voice = { ...voice, voice_sources: voice.voice_sources.filter((s) => !(s.kind === kind && s.account === account)) }; return voice; },
  rebuildVoice: () => never(),
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
  importNote: async () => {
    // Play a plausible article-by-article read over the wait; the connecting scene
    // stops partway so a screenshot catches the count mid-climb.
    const steps = scene === "intake-connecting" ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const timers = steps.map((i) => setTimeout(() => emitImport({ kind: "note", done: i, total: 10 }), 60 * i + 40));
    try {
      await wait(scene === "intake-connecting" ? 60_000 : 800);
    } finally {
      timers.forEach(clearTimeout);
    }
    return { pieces, total: 12, skipped_paid: 1, recent_only: false };
  },
  importMedium: async () => { await wait(300); return { pieces, total: null, skipped_paid: 0, recent_only: true }; },
  importXArchive: async () => { await wait(300); return { pieces, total: null, skipped_paid: 0, recent_only: false }; },
  onImportProgress: async (handler) => { importHandlers.add(handler); return () => { importHandlers.delete(handler); }; },
  onVoiceProgress: async (handler) => {
    const stages: T.VoiceProgress[] = [{ stage: "reading", done: 0, total: 3 }, { stage: "reading", done: 2, total: 3 }, { stage: "thinking" }, { stage: "checking" }, { stage: "extracted" }];
    const timers = stages.map((p, i) => setTimeout(() => handler(p), 800 * (i + 1)));
    return () => timers.forEach(clearTimeout);
  },
  openExternal: async () => {},
};
