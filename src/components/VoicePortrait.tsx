import { useEffect, useRef, useState } from "react";
import { host, type Backing, type Voice, type VoiceProfile } from "../platform/host";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { leadSentence } from "../summary";
import { ErrorNote } from "./ErrorNote";
import { connectionLabel } from "./SourceBox";
import { mockScene } from "../platform/mock";
import type { UiError } from "../platform/host";

const LANGUAGES: Record<string, string> = { ja: "日本語", en: "English", zh: "中文", ko: "한국어", fr: "Français", de: "Deutsch", es: "Español" };
const languageName = (tag: string) => LANGUAGES[tag.toLowerCase().split("-")[0]] ?? tag;

type Props = { voice: Voice; onChange: (v: Voice) => void; onDelete: () => void; onWrite?: () => void };

// The page where Lita's writing is adjusted (2026-09-23): the name, the one
// sentence Lita goes by, one main action, and then the eight things that can
// be changed, in three short groups, open from the start (requirement 2 of
// the voice feature; this revises D-56's "fold the details"). Rename and
// delete hide behind "…"; every row is edited in place.
export function VoicePortrait({ voice, onChange, onDelete, onWrite }: Props) {
  const [menu, setMenu] = useState(false);
  // Said once, quietly, after a change is saved: what it does and does not touch.
  const [saved, setSaved] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(voice.name);
  const [editingLine, setEditingLine] = useState(false);
  const [line, setLine] = useState(voice.profile.one_line);
  const [error, setError] = useState<UiError | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const p = voice.profile;
  const lead = p.one_line.trim() || leadSentence(p);
  // Where a value came from: the quotes Lita found, named by the writing they
  // came from. Shown only when asked for, so the page stays quiet (2026-09-23).
  const back = (field: string) => p.backing?.[field];
  const sourceLabel = (piece: number) => {
    const s = voice.voice_sources[piece];
    return s ? connectionLabel(s.kind, s.account) : null;
  };
  // One scene opens the first row's quotes so the screenshot shows them.
  const openField = mockScene() === "voice-evidence" ? "preferred_words" : null;

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 10000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

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
      setSaved(true);
    } catch (e) {
      setError(asUiError(e));
    }
  };

  const saveLine = async () => {
    const next = line.trim();
    setEditingLine(false);
    if (next && next !== p.one_line.trim()) await save({ ...p, one_line: next });
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
                <div className="kebab-wrap" ref={menuRef}>
                  <button className="kebab" aria-haspopup="menu" aria-expanded={menu} aria-label={t("voice.menu")} onClick={() => setMenu((m) => !m)}>…</button>
                  {menu && (
                    <div className="menu" role="menu">
                      <button role="menuitem" className="menu-item" onClick={() => { setMenu(false); setName(voice.name); setRenaming(true); }}>{t("voice.rename")}</button>
                      <button role="menuitem" className="menu-item danger" onClick={() => { setMenu(false); onDelete(); }}>{t("voice.delete")}</button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <p className="how">{t("voice.how")}</p>
          {editingLine ? (
            <form className="line-edit" onSubmit={(e) => { e.preventDefault(); void saveLine(); }}>
              <textarea aria-label={t("voice.how")} value={line} onChange={(e) => setLine(e.target.value)} rows={2} autoFocus />
              <div className="row">
                <button type="submit" className="btn sm">{t("action.save")}</button>
                <button type="button" className="quiet sm" onClick={() => { setLine(p.one_line); setEditingLine(false); }}>{t("action.cancel")}</button>
              </div>
            </form>
          ) : (
            <p className="lead">
              {lead}
              <button className="link" onClick={() => { setLine(lead); setEditingLine(true); }}>{t("action.fix")}</button>
            </p>
          )}
          {/* Where this voice started, said once and quietly (D-70). Nothing
              but a voice that came with Lita has no writing behind it, so the
              line goes as soon as any of your own is added. */}
          {voice.voice_sources.length === 0 && <p className="preset-note">{t("voice.preset.note")}</p>}
          <div className="cta">
            <button className="btn pri" onClick={onWrite} disabled={!onWrite}>{t("voice.write")}</button>
          </div>
        </div>
      </section>

      {error && <ErrorNote error={error} />}

      <div className="sheet-groups">
          <h4 className="sheet-head">{t("voice.group.words")}</h4>
          <dl className="sheet">
            <ListRow label={t("voice.card.preferred")} items={p.preferred_words} accent onSave={(v) => save({ ...p, preferred_words: v })} backing={back("preferred_words")} sourceLabel={sourceLabel} openAtFirst={openField === "preferred_words"} />
            <ListRow label={t("voice.card.avoided")} items={p.avoided_words} onSave={(v) => save({ ...p, avoided_words: v })} backing={back("avoided_words")} sourceLabel={sourceLabel} />
          </dl>
          <h4 className="sheet-head">{t("voice.group.tone")}</h4>
          <dl className="sheet">
            <TextRow label={t("voice.card.firstPerson")} value={p.first_person} onSave={(v) => save({ ...p, first_person: v })} backing={back("first_person")} sourceLabel={sourceLabel} />
            <TextRow label={t("voice.card.formality")} value={p.formality} onSave={(v) => save({ ...p, formality: v })} backing={back("formality")} sourceLabel={sourceLabel} />
            <ListRow label={t("voice.card.tone")} items={p.tone} onSave={(v) => save({ ...p, tone: v })} backing={back("tone")} sourceLabel={sourceLabel} />
            <ListRow label={t("voice.card.endings")} items={p.sentence_endings} onSave={(v) => save({ ...p, sentence_endings: v })} backing={back("sentence_endings")} sourceLabel={sourceLabel} />
          </dl>
          <h4 className="sheet-head">{t("voice.group.structure")}</h4>
          <dl className="sheet">
            <TextRow label={t("voice.card.opens")} value={p.opens_with} onSave={(v) => save({ ...p, opens_with: v })} backing={back("opens_with")} sourceLabel={sourceLabel} />
            <TextRow label={t("voice.card.closes")} value={p.closes_with} onSave={(v) => save({ ...p, closes_with: v })} backing={back("closes_with")} sourceLabel={sourceLabel} />
            {/* Only there when the stricter reading found them (2026-09-23). */}
            {(p.rhetoric ?? "").trim() && (
              <TextRow label={t("voice.card.rhetoric")} value={p.rhetoric ?? ""} onSave={(v) => save({ ...p, rhetoric: v })} backing={back("rhetoric")} sourceLabel={sourceLabel} />
            )}
            {(p.examples_and_numbers ?? "").trim() && (
              <TextRow label={t("voice.card.examples")} value={p.examples_and_numbers ?? ""} onSave={(v) => save({ ...p, examples_and_numbers: v })} backing={back("examples_and_numbers")} sourceLabel={sourceLabel} />
            )}
            {(p.kana_choices?.length ?? 0) > 0 && (
              <ListRow label={t("voice.card.kana")} items={p.kana_choices ?? []} onSave={(v) => save({ ...p, kana_choices: v })} backing={back("kana_choices")} sourceLabel={sourceLabel} />
            )}
            {(p.never_does?.length ?? 0) > 0 && (
              <ListRow label={t("voice.card.never")} items={p.never_does ?? []} onSave={(v) => save({ ...p, never_does: v })} backing={back("never_does")} sourceLabel={sourceLabel} />
            )}
          </dl>
          <p className="sheet-foot">
            <span>{t("voice.card.language")}: {languageName(p.language)}</span>
            <span className="sep">·</span>
            <span>{t("voice.card.emoji")}: {p.uses_emoji ? t("voice.card.yes") : t("voice.card.no")} <button className="link" onClick={() => void save({ ...p, uses_emoji: !p.uses_emoji })}>{t("action.fix")}</button></span>
            {p.representative_excerpts.length > 0 && (
              <>
                <span className="sep">·</span>
                <details className="excerpts-wrap">
                  <summary className="link-like">{t("voice.card.excerptsShow", { n: String(p.representative_excerpts.length) })}</summary>
                  <ul className="excerpts">
                    {p.representative_excerpts.map((e, i) => (
                      <li key={i}><blockquote>{e.excerpt}</blockquote><span className="muted small">{e.why}</span></li>
                    ))}
                  </ul>
                </details>
              </>
            )}
          </p>
          {saved && <p className="saved" role="status">{t("voice.savedNote")}</p>}
      </div>
    </div>
  );
}

/** What every row can say about itself: the quotes behind it, and how sure Lita is. */
type BackProps = { backing?: Backing; sourceLabel?: (piece: number) => string | null; openAtFirst?: boolean };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (<><dt>{label}</dt><dd>{children}</dd></>);
}

/**
 * Under the value: one quiet line when Lita is unsure, and a link that opens
 * the quotes it read. Nothing appears on profiles made before 2026-09-23.
 */
function Backed({ backing, sourceLabel, openAtFirst }: BackProps) {
  const [open, setOpen] = useState(Boolean(openAtFirst));
  if (!backing) return null;
  const quotes = backing.evidence?.slice(0, 4) ?? [];
  return (
    <>
      {quotes.length > 0 && (
        <button className="link edit why" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? t("action.close") : t("voice.card.evidence")}
        </button>
      )}
      {backing.confidence === "low" && <span className="muted small unsure">{t("voice.card.unsure")}</span>}
      {open && quotes.length > 0 && (
        <ul className="evidence">
          {quotes.map((e, i) => {
            const from = sourceLabel?.(e.piece) ?? null;
            return (<li key={i}><blockquote>{e.quote}</blockquote>{from && <span className="muted small">{from}</span>}</li>);
          })}
        </ul>
      )}
    </>
  );
}

function TextRow({ label, value, onSave, backing, sourceLabel, openAtFirst }: { label: string; value: string; onSave: (v: string) => void } & BackProps) {
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
      <Backed backing={backing} sourceLabel={sourceLabel} openAtFirst={openAtFirst} />
    </Row>
  );
}

function ListRow({ label, items, accent, onSave, backing, sourceLabel, openAtFirst }: { label: string; items: string[]; accent?: boolean; onSave: (v: string[]) => void } & BackProps) {
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
      <Backed backing={backing} sourceLabel={sourceLabel} openAtFirst={openAtFirst} />
    </Row>
  );
}
