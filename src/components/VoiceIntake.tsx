import { useEffect, useMemo, useState } from "react";
import { host, type MaterialBudget, type SourceInput, type SourceKind, type UiError } from "../platform/host";
import { t } from "../i18n";
import { ErrorNote } from "./ErrorNote";
import { mockScene } from "../platform/mock";
import { SourceBox, connectionLabel, type Gathered } from "./SourceBox";

type Piece = Gathered & { key: number; selected: boolean; editing: boolean };

let nextKey = 1;

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
  if (p.kind === "file" && p.origin) return p.origin;
  const first = p.body.trim().split("\n")[0] ?? "";
  return first ? [...first].slice(0, 60).join("") : t("voice.intake.untitled");
};

// The voice is named after where its writing came from first, so a second
// one never collides with the first ("note・kuno", "貼った文章 (2)").
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
// then build. The pieces stay folded behind "見直す" because the default is
// to use them all.
export function VoiceIntake({ onBuild, error, existing = [] }: Props) {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [review, setReview] = useState(false);
  const [budget, setBudget] = useState<MaterialBudget>({ per_piece_chars: 1500, total_chars: 20000 });

  useEffect(() => { void host.materialBudget().then(setBudget).catch(() => {}); }, []);
  useEffect(() => {
    if (mockScene() === "intake-loaded") {
      void host.importNote("kuno").then((r) => add(r.pieces.map((p) => ({ kind: "note" as const, origin: p.url, account: "kuno", title: p.title, body: p.text }))));
    }
  }, []);

  const selected = pieces.filter((p) => p.selected && p.body.trim().length > 0);
  const use = useMemo(() => usage(selected, budget), [selected, budget]);
  const empty = pieces.length === 0;
  const connections = connectionsOf(selected);
  const first = connections[0];
  const name = uniqueName(first ? connectionLabel(first.kind, first.account) : t("voice.name.pasted"), existing);

  const add = (items: Gathered[]) => {
    const editing = items.length === 1 && items[0].kind === "paste" && !items[0].body;
    if (editing || items.some((i) => i.kind === "file")) setReview(true);
    setPieces((ps) => [...ps, ...items.map((p) => ({ key: nextKey++, selected: true, editing, ...p }))]);
  };
  const patch = (key: number, change: Partial<Piece>) => setPieces((ps) => ps.map((p) => (p.key === key ? { ...p, ...change } : p)));
  const remove = (key: number) => setPieces((ps) => ps.filter((p) => p.key !== key));
  const known = useMemo(() => new Set(pieces.map((p) => p.origin).filter((o): o is string => !!o)), [pieces]);

  const showTiles = review || pieces.some((p) => p.editing);

  return (
    <div className="intake">
      <h2>{t("voice.intake.title")}</h2>
      <p className="sub">{empty ? t("voice.intake.leadEmpty") : `${t("voice.intake.lead")} ${t("voice.intake.more")}`}</p>

      <SourceBox hero={empty} known={known} onGathered={add} />

      {!empty && (
        <>
          <p className="using-line">
            {use.count === 0 ? t("ready.none") : (
              <>
                {connections.map((c, i) => (
                  <span key={i} className="conn">{i > 0 && <span className="sep">·</span>}{connectionLabel(c.kind, c.account)} <span className="muted">{t("voice.sources.count", { n: String(c.count) })}</span></span>
                ))}
              </>
            )}
            {use.truncated > 0 && <> {t("ready.truncated", { n: String(use.truncated), per: budget.per_piece_chars.toLocaleString() })}</>}
            {use.dropped > 0 && <> {t("ready.dropped", { n: String(use.dropped) })}</>}
            {" "}
            <button className="link" aria-expanded={showTiles} onClick={() => setReview((r) => !r)}>{showTiles ? t("voice.intake.reviewClose") : t("voice.intake.review")}</button>
          </p>
          {showTiles && (
            <ul className="tiles">
              {pieces.map((p) => {
                const id = `piece-${p.key}`;
                const title = label(p);
                return (
                  <li key={p.key} className={`tile ${p.selected ? "on" : "off"} ${p.editing ? "editing" : ""}`}>
                    <input id={id} type="checkbox" className="sr-only" checked={p.selected} onChange={(e) => patch(p.key, { selected: e.target.checked })} />
                    <label htmlFor={id} className="tile-body">
                      <span className="chk" aria-hidden="true">{p.selected ? "✓" : ""}</span>
                      <span className="t">{title}</span>
                      {!p.editing && <span className="x">{p.body.trim().slice(0, 140)}</span>}
                      <span className="s"><span className="badge">{t(`kind.${p.kind}` as const)}</span></span>
                    </label>
                    {p.editing && (
                      <textarea aria-label={title} value={p.body} onChange={(e) => patch(p.key, { body: e.target.value })} placeholder={t("voice.intake.piecePlaceholder")} rows={6} autoFocus={p.kind === "paste"} />
                    )}
                    <span className="tile-actions">
                      <button className="link" onClick={() => patch(p.key, { editing: !p.editing })}>{p.editing ? t("action.done") : t("action.edit")}</button>
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

      {!empty && (
        <div className="finish" role="region" aria-label={t("voice.intake.build")}>
          <div className="ready"><div className="g">{t("ready.name", { name })}</div></div>
          <button className="btn pri" disabled={use.count === 0} onClick={() => onBuild(name, selected.map(({ kind, origin, account, body }) => ({ kind, origin, account, body })))}>
            {t("voice.intake.build")}
          </button>
        </div>
      )}
      <footer className="privacy">{t("privacy.note")}</footer>
    </div>
  );
}
