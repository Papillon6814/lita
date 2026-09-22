import type { Voice } from "../platform/host";
import { t } from "../i18n";

export function VoiceCard({ voice, onStartOver }: { voice: Voice; onStartOver: () => void }) {
  const p = voice.profile;
  const list = (xs: string[]) => (xs.length ? xs.join(" / ") : "—");
  return (
    <div className="voice">
      <div className="row">
        <div>
          <h2>{voice.name}</h2>
          <p className="muted">{t("voice.card.sources", { n: String(voice.voice_sources.length) })}</p>
        </div>
        <button className="secondary" onClick={onStartOver}>{t("voice.card.startOver")}</button>
      </div>
      <dl className="profile">
        <dt>{t("voice.card.language")}</dt><dd>{p.language}</dd>
        <dt>{t("voice.card.firstPerson")}</dt><dd>{p.first_person || "—"}</dd>
        <dt>{t("voice.card.formality")}</dt><dd>{p.formality}</dd>
        <dt>{t("voice.card.tone")}</dt><dd>{list(p.tone)}</dd>
        <dt>{t("voice.card.endings")}</dt><dd>{list(p.sentence_endings)}</dd>
        <dt>{t("voice.card.length")}</dt><dd>{t("voice.card.lengthValue", { n: String(p.avg_sentence_length_chars) })}</dd>
        <dt>{t("voice.card.preferred")}</dt><dd>{list(p.preferred_words)}</dd>
        <dt>{t("voice.card.avoided")}</dt><dd>{list(p.avoided_words)}</dd>
        <dt>{t("voice.card.opens")}</dt><dd>{p.opens_with || "—"}</dd>
        <dt>{t("voice.card.closes")}</dt><dd>{p.closes_with || "—"}</dd>
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
