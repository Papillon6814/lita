import type { Voice } from "../platform/host";
import { t } from "../i18n";

const LANGUAGES: Record<string, string> = { ja: "日本語", en: "English", zh: "中文", ko: "한국어", fr: "Français", de: "Deutsch", es: "Español" };

function languageName(tag: string): string {
  const base = tag.toLowerCase().split("-")[0];
  return LANGUAGES[base] ?? tag;
}

function Chips({ items, accent }: { items: string[]; accent?: boolean }) {
  if (!items.length) return <span className="muted">{t("voice.card.none")}</span>;
  return (
    <span className="chips">
      {items.map((x, i) => <span key={i} className={accent ? "chip accent" : "chip"}>{x}</span>)}
    </span>
  );
}

export function VoiceCard({ voice, onStartOver }: { voice: Voice; onStartOver: () => void }) {
  const p = voice.profile;
  const text = (s: string) => s.trim() ? s : <span className="muted">{t("voice.card.none")}</span>;
  const created = new Date(voice.created_at).toLocaleDateString();
  return (
    <div className="voice">
      <div className="row">
        <h2>{voice.name}</h2>
        <button className="quiet" onClick={onStartOver}>{t("voice.card.startOver")}</button>
      </div>
      <p className="muted small voice-meta">{t("voice.card.meta", { n: String(voice.voice_sources.length), date: created })}</p>
      <dl className="profile">
        <dt>{t("voice.card.language")}</dt><dd>{languageName(p.language)}</dd>
        <dt>{t("voice.card.firstPerson")}</dt><dd>{text(p.first_person)}</dd>
        <dt>{t("voice.card.formality")}</dt><dd>{text(p.formality)}</dd>
        <dt>{t("voice.card.tone")}</dt><dd><Chips items={p.tone} /></dd>
        <dt>{t("voice.card.endings")}</dt><dd><Chips items={p.sentence_endings} /></dd>
        <dt>{t("voice.card.length")}</dt><dd>{t("voice.card.lengthValue", { n: String(p.avg_sentence_length_chars) })}</dd>
        <dt>{t("voice.card.preferred")}</dt><dd><Chips items={p.preferred_words} accent /></dd>
        <dt>{t("voice.card.avoided")}</dt><dd><Chips items={p.avoided_words} /></dd>
        <dt>{t("voice.card.opens")}</dt><dd>{text(p.opens_with)}</dd>
        <dt>{t("voice.card.closes")}</dt><dd>{text(p.closes_with)}</dd>
        <dt>{t("voice.card.emoji")}</dt><dd>{p.uses_emoji ? t("voice.card.yes") : t("voice.card.no")}</dd>
      </dl>
      {p.representative_excerpts.length > 0 && (
        <details>
          <summary>{t("voice.card.excerpts")}</summary>
          <ul className="excerpts">
            {p.representative_excerpts.map((e, i) => (
              <li key={i}><blockquote>{e.excerpt}</blockquote><span className="muted small">{e.why}</span></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
