// English is the default; other locales must cover every key (enforced by
// the Record<MessageKey, string> type on each locale file).

import { en, type MessageKey } from "./en";
import { ja } from "./ja";

const locales = { en, ja } as const;
export type Locale = keyof typeof locales;

export function detectLocale(): Locale {
  const lang = typeof navigator === "undefined" ? "en" : navigator.language.toLowerCase();
  return lang.startsWith("ja") ? "ja" : "en";
}

export function t(key: MessageKey, vars: Record<string, string> = {}, locale: Locale = detectLocale()): string {
  const template = locales[locale][key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);
}
