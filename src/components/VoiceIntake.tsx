import { useEffect, useMemo, useRef, useState } from "react";
import { host, type MaterialBudget, type SourceInput, type SourceKind, type UiError } from "../platform/host";
import { t } from "../i18n";
import { ErrorNote } from "./ErrorNote";
import { mockScene } from "../platform/mock";
import { SourceBox, connectionLabel, type Gathered } from "./SourceBox";
import { PasteBox, pieceTitle, type ManualKind, type NewPiece } from "./PasteBox";

type Piece = Gathered & { key: number; selected: boolean; editing: boolean };

let nextKey = 1;

const byHand = (kind: SourceKind): kind is ManualKind => kind === "paste" || kind === "file";

// Mirrors lita_codex::voice::select_material so what is said matches what
// will actually be sent (R-1). Only trouble is reported; the numbers stay
// out of the person's way unless they bite.
function usage(pieces: Piece[], budget: MaterialBudget) {
  let chars = 0, count = 0, truncated = 0, dropped = 0;
  for (const p of pieces) {
    const len = [...p.body.trim()].length;
    if (len === 0) continue;
    if (chars >= budget.total_chars) { dropped++; continue; }
    const limit = Math.min(budget.per_piece_chars, budget.total_chars - chars);
    if (len > limit) truncated++;
    chars += Math.min(len, limit);
    count++;
  }
  return { chars, count, truncated, dropped };
}

const label = (p: Piece) => {
  if (p.title) return p.title;
  return pieceTitle({ kind: p.kind === "file" ? "file" : "paste", origin: p.origin, body: p.body });
};

// The voice is named after where its writing came from first, so a second
// one never collides with the first ("note・kuno", "自分の文章 (2)").
function uniqueName(base: string, existing: string[]) {
  if (!existing.includes(base)) return base;
  for (let i = 2; ; i++) { const n = `${base} (${i})`; if (!existing.includes(n)) return n; }
}

/** Connections present in a set of pieces, in first-seen order, with counts. */
export function connectionsOf<T extends { kind: SourceKind; account: string | null }>(pieces: T[]) {
  const out: { kind: SourceKind; account: string | null; count: number }[] = [];
  for (const p of pieces) {
    const c = out.find((x) => x.kind === p.kind && x.account === p.account);
    if (c) c.count++; else out.push({ kind: p.kind, account: p.account, count: 1 });
  }
  return out;
}

type Props = { onBuild: (name: string, sources: SourceInput[]) => void; error?: UiError; existing?: string[] };

// One road (UX review 2026-09-23): gather from as many places as you like,
// then build. Material arrives two ways, in two boxes: pasted or dropped by
// hand (PasteBox, first, its pieces always in view) or pulled from where it
// was published (SourceBox, second, folded behind "見直す"). Either box alone
// is enough, and there is still one primary button.
export function VoiceIntake({ onBuild, error, existing = [] }: Props) {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [review, setReview] = useState(false);
  const [budget, setBudget] = useState<MaterialBudget>({ per_piece_chars: 1500, total_chars: 20000 });
  // Pressing 文体を作る with nothing gathered puts the keyboard in the paste field.
  const [focusPaste, setFocusPaste] = useState(0);

  useEffect(() => { void host.materialBudget().then(setBudget).catch(() => {}); }, []);
  // Strict mode runs an effect twice; the seeded scenes must not double up.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (mockScene() === "intake-loaded") {
      void host.importNote("kuno").then((r) => add(r.pieces.map((p) => ({ kind: "note" as const, origin: p.url, account: "kuno", title: p.title, body: p.text }))));
    }
    if (mockScene() === "intake-manual") {
      addManual([
        { kind: "paste", origin: null, body: "エクイティは返さなくていい金ではなく、いちばん高い金です。返済期限がないぶん、会社の持ち分を削ります。" },
        { kind: "paste", origin: null, body: "買収の相談で最初に聞くのは値段ではありません。売り手が何を手放したくないか、です。" },
        { kind: "paste", origin: null, body: "小さな会社の資金繰りは、月末ではなく週で見ます。遅れている入金と、動かせる支払いが分けて見えます。" },
      ]);
    }
  }, []);

  const selected = pieces.filter((p) => p.selected && p.body.trim().length > 0);
  const use = useMemo(() => usage(selected, budget), [selected, budget]);
  const empty = pieces.length === 0;
  const connections = connectionsOf(selected);
  const first = connections[0];
  const name = uniqueName(first ? connectionLabel(first.kind, first.account) : t("voice.name.pasted"), existing);

  const add = (items: Gathered[]) => {
    setPieces((ps) => [...ps, ...items.map((p) => ({ key: nextKey++, selected: true, editing: false, ...p }))]);
  };
  const addManual = (items: NewPiece[]) => add(items.map((i) => ({ kind: i.kind, origin: i.origin, account: null, title: null, body: i.body })));
  const patch = (key: number, change: Partial<Piece>) => setPieces((ps) => ps.map((p) => (p.key === key ? { ...p, ...change } : p)));
  const remove = (key: number) => setPieces((ps) => ps.filter((p) => p.key !== key));
  // Joining a hand-entered piece with the one above it: the way back from splitting too far.
  const mergeUp = (key: number) => setPieces((ps) => {
    const hand = ps.filter((p) => byHand(p.kind));
    const at = hand.findIndex((p) => p.key === key);
    if (at < 1) return ps;
    const prev = hand[at - 1], cur = hand[at];
    return ps
      .map((p) => (p.key === prev.key ? { ...p, body: `${p.body.trim()}\n\n${cur.body.trim()}` } : p))
      .filter((p) => p.key !== cur.key);
  });
  const known = useMemo(() => new Set(pieces.map((p) => p.origin).filter((o): o is string => !!o)), [pieces]);

  const hand = pieces.filter((p) => byHand(p.kind));
  const connected = pieces.filter((p) => !byHand(p.kind));
  const showTiles = review && connected.length > 0;

  return (
    <div className="intake">
      <h2>{t("voice.intake.title")}</h2>
      <p className="sub">{t("voice.intake.lead")}</p>

      {/* The shape of what is being made, before anything is in it: the same
          three groups the voice page shows, as empty placeholders. */}
      <section className="preview-card">
        <h3 className="sheet-head">{t("voice.how")}</h3>
        <dl className="sheet plain">
          <dt>{t("voice.group.words")}</dt>
          <dd className="muted">{t("voice.card.preferred")}<span className="sep">/</span>{t("voice.card.avoided")}</dd>
          <dt>{t("voice.group.tone")}</dt>
          <dd className="muted">{t("voice.card.firstPerson")}<span className="sep">/</span>{t("voice.card.formality")}<span className="sep">/</span>{t("voice.card.tone")}<span className="sep">/</span>{t("voice.card.endings")}</dd>
          <dt>{t("voice.group.structure")}</dt>
          <dd className="muted">{t("voice.card.opens")}<span className="sep">/</span>{t("voice.card.closes")}</dd>
        </dl>
      </section>

      <PasteBox
        pieces={hand.map((p) => ({ id: String(p.key), kind: p.kind === "file" ? "file" : "paste", origin: p.origin, body: p.body }))}
        total={pieces.filter((p) => p.body.trim().length > 0).length}
        focus={focusPaste}
        onAdd={addManual}
        onRemove={(id) => remove(Number(id))}
        onEdit={(id, body) => patch(Number(id), { body })}
        onMerge={(id) => mergeUp(Number(id))}
      />

      <p className="or">{t("intake.or")}</p>

      <section className="box connect-box" aria-label={t("intake.box.connect")}>
        <h3 className="box-head">{t("intake.box.connect")}</h3>
        <SourceBox known={known} connected={connectionsOf(connected)} onGathered={add} onRemove={(kind, account) => setPieces((ps) => ps.filter((p) => !(p.kind === kind && p.account === account)))} />
      </section>

      {!empty && (
        <>
          <p className="using-line">
            {use.count === 0 ? t("ready.none") : t("voice.intake.usingLine", { n: String(use.count) })}
            {use.truncated > 0 && <> {t("ready.truncated", { n: String(use.truncated) })}</>}
            {use.dropped > 0 && <> {t("ready.dropped", { n: String(use.dropped) })}</>}
            {connected.length > 0 && (
              <>
                {" "}
                <button className="link" aria-expanded={showTiles} onClick={() => setReview((r) => !r)}>{showTiles ? t("voice.intake.reviewClose") : t("voice.intake.review")}</button>
              </>
            )}
          </p>
          {showTiles && (
            <ul className="tiles">
              {connected.map((p) => {
                const id = `piece-${p.key}`;
                const title = label(p);
                return (
                  <li key={p.key} className={`tile ${p.selected ? "on" : "off"}`}>
                    <input id={id} type="checkbox" className="sr-only" checked={p.selected} onChange={(e) => patch(p.key, { selected: e.target.checked })} />
                    <label htmlFor={id} className="tile-body">
                      <span className="chk" aria-hidden="true">{p.selected ? "✓" : ""}</span>
                      <span className="t">{title}</span>
                      <span className="x">{p.body.trim().slice(0, 140)}</span>
                      <span className="s"><span className="badge">{t(`kind.${p.kind}` as const)}</span></span>
                    </label>
                    <span className="tile-actions">
                      <button className="link" aria-label={`${t("action.remove")}: ${title}`} onClick={() => remove(p.key)}>{t("action.remove")}</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {error && <ErrorNote error={error} />}

      {empty ? (
        <div className="row start-row">
          <button className="btn pri" onClick={() => setFocusPaste((n) => n + 1)}>{t("voice.intake.build")}</button>
        </div>
      ) : (
        <div className="finish" role="region" aria-label={t("voice.intake.build")}>
          <div className="ready">
            {t("ready.name", { name })}
            <span className="g">{t("privacy.note")}</span>
          </div>
          <button className="btn pri" disabled={use.count === 0} onClick={() => onBuild(name, selected.map(({ kind, origin, account, body }) => ({ kind, origin, account, body })))}>
            {t("voice.intake.build")}
          </button>
        </div>
      )}
    </div>
  );
}
