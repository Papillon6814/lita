import { useState } from "react";
import { host, type Voice, type VoiceProfile } from "../platform/host";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { leadSentence } from "../summary";
import { ErrorNote } from "./ErrorNote";
import type { UiError } from "../platform/host";
import { mockScene } from "../platform/mock";

const LANGUAGES: Record<string, string> = { ja: "日本語", en: "English", zh: "中文", ko: "한국어", fr: "Français", de: "Deutsch", es: "Español" };
const languageName = (tag: string) => LANGUAGES[tag.toLowerCase().split("-")[0]] ?? tag;

type Props = { voice: Voice; onChange: (v: Voice) => void; onStartOver: () => void; onWrite?: () => void };

// The daily screen: Lita's one-line reading, the main action, details folded.
export function VoicePortrait({ voice, onChange, onStartOver, onWrite }: Props) {
  const [open, setOpen] = useState(mockScene() === "voice-open");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(voice.name);
  const [error, setError] = useState<UiError | null>(null);
  const p = voice.profile;
  const created = new Date(voice.created_at).toLocaleDateString();

  const rename = async () => {
    const next = name.trim();
    if (!next || next === voice.name) return setRenaming(false);
    try {
      await host.renameVoice(voice.id, next);
      onChange({ ...voice, name: next });
      setRenaming(false);
    } catch (e) {
      setError(asUiError(e));
    }
  };

  const save = async (profile: VoiceProfile) => {
    try {
      const updated = await host.updateVoiceProfile(voice.id, profile);
      if (updated) onChange(updated);
      setError(null);
    } catch (e) {
      setError(asUiError(e));
    }
  };

  return (
    <div className="voice">
      <section className="portrait">
        <div className="mono" aria-hidden="true">{[...voice.name][0]?.toUpperCase() ?? "V"}</div>
        <div>
          <div className="name-row">
            {renaming ? (
              <form className="row" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
                <input aria-label={t("voice.renamePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                <button type="submit" className="btn sm">{t("action.save")}</button>
                <button type="button" className="quiet sm" onClick={() => { setName(voice.name); setRenaming(false); }}>{t("action.cancel")}</button>
              </form>
            ) : (
              <>
                <h2>{voice.name}</h2>
                <button className="quiet sm" onClick={() => setRenaming(true)}>{t("voice.rename")}</button>
              </>
            )}
          </div>
          <p className="lead">{p.one_line.trim() || leadSentence(p)}</p>
          <p className="attr">
            {t("voice.attribution", { n: String(voice.voice_sources.length), date: created })}{" "}
            <button className="link" onClick={() => setOpen(true)}>{t("voice.fixSummary")}</button>
          </p>
          <div className="cta">
            <button className="btn pri" onClick={onWrite} disabled={!onWrite}>{t("voice.write")}</button>
            <button className="quiet" onClick={onStartOver}>{t("voice.delete")}</button>
          </div>
        </div>
      </section>

      {error && <ErrorNote error={error} />}

      <details className="more" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>{open ? t("voice.details.hide") : t("voice.details.show")}</summary>
        <dl className="sheet">
          <TextRow label={t("voice.card.oneLine")} value={p.one_line} onSave={(v) => save({ ...p, one_line: v })} />
          <Row label={t("voice.card.language")}>{languageName(p.language)}</Row>
          <TextRow label={t("voice.card.firstPerson")} value={p.first_person} onSave={(v) => save({ ...p, first_person: v })} />
          <TextRow label={t("voice.card.formality")} value={p.formality} onSave={(v) => save({ ...p, formality: v })} />
          <ListRow label={t("voice.card.tone")} items={p.tone} onSave={(v) => save({ ...p, tone: v })} />
          <ListRow label={t("voice.card.endings")} items={p.sentence_endings} onSave={(v) => save({ ...p, sentence_endings: v })} />
          <Row label={t("voice.card.length")}>{t("voice.card.lengthValue", { n: String(p.avg_sentence_length_chars) })}</Row>
          <ListRow label={t("voice.card.preferred")} items={p.preferred_words} accent onSave={(v) => save({ ...p, preferred_words: v })} />
          <ListRow label={t("voice.card.avoided")} items={p.avoided_words} onSave={(v) => save({ ...p, avoided_words: v })} />
          <TextRow label={t("voice.card.opens")} value={p.opens_with} onSave={(v) => save({ ...p, opens_with: v })} />
          <TextRow label={t("voice.card.closes")} value={p.closes_with} onSave={(v) => save({ ...p, closes_with: v })} />
          <Row label={t("voice.card.emoji")}>
            <button className="link" onClick={() => void save({ ...p, uses_emoji: !p.uses_emoji })}>{p.uses_emoji ? t("voice.card.yes") : t("voice.card.no")}</button>
          </Row>
          {p.representative_excerpts.length > 0 && (
            <Row label={t("voice.card.excerpts")}>
              <details className="excerpts-wrap">
                <summary className="link-like">{t("voice.card.excerptsShow", { n: String(p.representative_excerpts.length) })}</summary>
                <ul className="excerpts">
                  {p.representative_excerpts.map((e, i) => (
                    <li key={i}><blockquote>{e.excerpt}</blockquote><span className="muted small">{e.why}</span></li>
                  ))}
                </ul>
              </details>
            </Row>
          )}
        </dl>
      </details>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (<><dt>{label}</dt><dd>{children}</dd></>);
}

function TextRow({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) {
    return (
      <Row label={label}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); onSave(draft.trim()); setEditing(false); }}>
          <input aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <button type="submit" className="btn sm">{t("action.save")}</button>
          <button type="button" className="quiet sm" onClick={() => { setDraft(value); setEditing(false); }}>{t("action.cancel")}</button>
        </form>
      </Row>
    );
  }
  return (
    <Row label={label}>
      {value.trim() ? value : <span className="muted">{t("voice.card.none")}</span>}
      <button className="link edit" onClick={() => { setDraft(value); setEditing(true); }}>{value.trim() ? t("action.fix") : t("action.add")}</button>
    </Row>
  );
}

function ListRow({ label, items, accent, onSave }: { label: string; items: string[]; accent?: boolean; onSave: (v: string[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(items.join("、"));
  const parse = (s: string) => s.split(/[、,]/).map((x) => x.trim()).filter(Boolean);
  if (editing) {
    return (
      <Row label={label}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); onSave(parse(draft)); setEditing(false); }}>
          <input aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("voice.card.listHint")} autoFocus />
          <button type="submit" className="btn sm">{t("action.save")}</button>
          <button type="button" className="quiet sm" onClick={() => { setDraft(items.join("、")); setEditing(false); }}>{t("action.cancel")}</button>
        </form>
      </Row>
    );
  }
  return (
    <Row label={label}>
      {items.length === 0 ? <span className="muted">{t("voice.card.none")}</span> : items.map((x, i) => (
        <span key={i}>{i > 0 && <span className="sep">/</span>}<span className={accent ? "hi" : undefined}>{x}</span></span>
      ))}
      <button className="link edit" onClick={() => { setDraft(items.join("、")); setEditing(true); }}>{items.length ? t("action.fix") : t("action.add")}</button>
    </Row>
  );
}
