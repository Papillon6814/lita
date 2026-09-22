// The one sentence at the top of the Voice screen when the profile does not
// carry Codex's own (`one_line`, added 2026-09-22). It is Lita's reading, not
// a verdict on the person, so it always speaks about "your writing".
//
// Field values come back in the language of the samples, not of the UI
// (see VoiceProfile::extraction_prompt), so the template follows the
// profile's language: a Japanese UI reading an English voice still gets an
// English sentence rather than 「常体でanalytical」.

import type { VoiceProfile } from "./platform/host";
import { t, type Locale } from "./i18n";

const CASUAL_HINTS = ["informal", "casual", "常体", "だ・である", "である調", "タメ口", "plain"];
const FORMAL_HINTS = ["です", "ます", "敬体", "丁寧", "polite", "formal", "professional"];

/** The locale whose template can hold this profile's values. */
function templateLocale(p: VoiceProfile): Locale {
  return p.language.toLowerCase().startsWith("ja") ? "ja" : "en";
}

function isFormal(formality: string): boolean {
  const f = formality.toLowerCase();
  if (CASUAL_HINTS.some((h) => f.includes(h))) return false;
  return FORMAL_HINTS.some((h) => f.includes(h));
}

/** Keeps a list readable: at most two short entries. */
function pick(items: string[], maxLen: number): string[] {
  return items.map((s) => s.trim()).filter((s) => s.length > 0 && [...s].length <= maxLen).slice(0, 2);
}

export function leadSentence(p: VoiceProfile): string {
  const locale = templateLocale(p);
  const ja = locale === "ja";
  const formality = t(isFormal(p.formality) ? "summary.formal" : "summary.casual", {}, locale);
  const tones = pick(p.tone, ja ? 12 : 30);
  const tone = tones.join(ja ? "で" : " and ");
  const words = pick(p.preferred_words, ja ? 12 : 24);
  const wordList = ja ? words.join("や") : words.join(" and ");
  const ending = pick(p.sentence_endings, 16).map((e) => e.replace(/[。.]+$/, ""))[0] ?? "";
  if (!tone && !p.formality.trim()) return t("summary.empty", {}, locale);
  if (!tone) return t("summary.leadShort", { tone: formality }, locale);
  if (!ending && !wordList) return t("summary.leadShort", { tone: `${formality}${ja ? "で" : ", "}${tone}` }, locale);
  if (!ending) return t("summary.leadNoEnding", { formality, tone, words: wordList }, locale);
  if (!wordList) return t("summary.leadNoWords", { formality, tone, ending }, locale);
  return t("summary.lead", { formality, tone, words: wordList, ending }, locale);
}
