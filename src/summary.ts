// The one sentence at the top of the Voice screen, built from the profile.
// It is Lita's reading, not a verdict on the person, so it always speaks
// about "your writing" (UX review, 2026-09-22).

import type { VoiceProfile } from "./platform/host";
import { detectLocale, t } from "./i18n";

const FORMAL_HINTS = ["です", "ます", "敬体", "polite", "formal"];

export function leadSentence(p: VoiceProfile): string {
  const ja = detectLocale() === "ja";
  const formal = FORMAL_HINTS.some((h) => p.formality.toLowerCase().includes(h)) && !p.formality.includes("常体");
  const formality = t(formal ? "summary.formal" : "summary.casual");
  const tone = p.tone.slice(0, 2).join(ja ? "で" : " and ");
  const words = p.preferred_words.slice(0, 2).join(ja ? "や" : " and ");
  const ending = (p.sentence_endings[0] ?? "").replace(/[。.]+$/, "");
  if (!tone) return t("summary.leadShort", { tone: p.formality || formality });
  if (!ending) return t("summary.leadShort", { tone: `${formality}${ja ? "で" : " and "}${tone}` });
  if (!words) return t("summary.leadNoWords", { formality, tone, ending });
  return t("summary.lead", { formality, tone, words, ending });
}
