import { useEffect, useMemo, useRef, useState } from "react";
import { host, type Imported, type MaterialBudget, type SourceInput, type SourceKind, type UiError } from "../platform/host";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { ErrorNote } from "./ErrorNote";
import { mockScene } from "../platform/mock";

type Piece = { key: number; kind: SourceKind; origin: string | null; title: string | null; body: string; selected: boolean; editing: boolean };
type Source = "note" | "medium" | "x";
type ImportState = { kind: "idle" } | { kind: "working" } | { kind: "done"; result: Imported } | { kind: "error"; error: UiError };

let nextKey = 1;

// Mirrors lita_codex::voice::select_material so the bar matches what will
// actually be sent (R-1). Only the readiness is shown; the numbers stay
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

export function VoiceIntake({ onBuild, error }: { onBuild: (name: string, sources: SourceInput[]) => void; error?: UiError }) {
  const [source, setSource] = useState<Source>("note");
  const [account, setAccount] = useState("");
  const [xReplies, setXReplies] = useState(false);
  const [imp, setImp] = useState<ImportState>({ kind: "idle" });
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [budget, setBudget] = useState<MaterialBudget>({ per_piece_chars: 1500, total_chars: 20000 });
  const xInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { void host.materialBudget().then(setBudget).catch(() => {}); }, []);
  useEffect(() => { if (mockScene() === "intake-loaded") { setAccount("kuno"); void runImport("note", () => host.importNote("kuno")); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const selected = pieces.filter((p) => p.selected && p.body.trim().length > 0);
  const use = useMemo(() => usage(selected, budget), [selected, budget]);
  const empty = pieces.length === 0;
  const name = t("voice.defaultName");

  const add = (items: Omit<Piece, "key" | "selected" | "editing">[], editing = false) =>
    setPieces((ps) => [...ps, ...items.map((p) => ({ key: nextKey++, selected: true, editing, ...p }))]);
  const patch = (key: number, change: Partial<Piece>) => setPieces((ps) => ps.map((p) => (p.key === key ? { ...p, ...change } : p)));
  const remove = (key: number) => setPieces((ps) => ps.filter((p) => p.key !== key));

  const runImport = async (kind: SourceKind, fetch: () => Promise<Imported>) => {
    setImp({ kind: "working" });
    try {
      const result = await fetch();
      add(result.pieces.map((p) => ({ kind, origin: p.url, title: p.title, body: p.text })));
      setImp({ kind: "done", result });
    } catch (e) {
      setImp({ kind: "error", error: asUiError(e) });
    }
  };

  const submit = () => {
    if (!account.trim()) return;
    if (source === "note") void runImport("note", () => host.importNote(account));
    else if (source === "medium") void runImport("medium", () => host.importMedium(account));
  };

  const onXFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const contents = await f.text();
    await runImport("x", () => host.importXArchive(contents, null, xReplies));
    if (xInput.current) xInput.current.value = "";
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const read = await Promise.all(Array.from(files).map(async (f) => ({ kind: "file" as const, origin: f.name, title: f.name, body: await f.text() })));
    add(read);
    if (fileInput.current) fileInput.current.value = "";
  };

  const busy = imp.kind === "working";
  const readiness =
    use.count === 0 ? t("ready.none") : use.count >= 20 ? t("ready.plenty", { n: String(use.count) }) : t("ready.some", { n: String(use.count) });

  return (
    <div className="intake">
      <h2>{t("voice.intake.title")}</h2>
      <p className="sub">{empty ? t("voice.intake.leadEmpty") : t("voice.intake.lead")}</p>

      <h3 className="step">{t("voice.intake.sources")}</h3>
      <div className={empty ? "srcbox hero" : "srcbox"}>
        <div className="seg" role="tablist">
          {(["note", "medium", "x"] as Source[]).map((s) => (
            <button key={s} role="tab" aria-selected={source === s} className={source === s ? "on" : ""} onClick={() => setSource(s)}>{t(`source.${s}` as const)}</button>
          ))}
        </div>
        {source === "x" ? (
          <div className="row wrap">
            <button className="btn pri" disabled={busy} onClick={() => xInput.current?.click()}>{t("import.xPick")}</button>
            <label className="check"><input type="checkbox" checked={xReplies} onChange={(e) => setXReplies(e.target.checked)} /> {t("import.xReplies")}</label>
            <input ref={xInput} type="file" accept=".js,.json,text/javascript,application/json" hidden onChange={(e) => void onXFile(e.target.files)} />
          </div>
        ) : (
          <form className="row" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <label htmlFor="import-account" className="sr-only">{t(`source.${source}` as const)}</label>
            <input id="import-account" value={account} onChange={(e) => setAccount(e.target.value)} placeholder={source === "note" ? t("import.notePlaceholder") : t("import.mediumPlaceholder")} disabled={busy} autoComplete="off" />
            <button type="submit" className="btn pri" disabled={busy || !account.trim()}>{t("import.go")}</button>
          </form>
        )}
        <p className="hint" role="status">
          {imp.kind === "working" ? t("import.working")
            : imp.kind === "done" ? (
              <>
                {imp.result.total != null ? t("import.resultTotal", { n: String(imp.result.pieces.length), total: String(imp.result.total) }) : t("import.result", { n: String(imp.result.pieces.length) })}
                {imp.result.skipped_paid > 0 && <> {t("import.skippedPaid", { n: String(imp.result.skipped_paid) })}</>}
              </>
            ) : (
              <>{source === "note" ? t("import.noteHint") : source === "medium" ? t("import.mediumHint") : t("import.xHint")}{empty && <> {t("import.emptyHint")}</>}</>
            )}
        </p>
        {imp.kind === "error" && <ErrorNote error={imp.error} />}
        <div className="manual">
          <span>{t("import.manual")}</span>
          <button className="link" onClick={() => add([{ kind: "paste", origin: null, title: null, body: "" }], true)}>{t("import.manualWrite")}</button>
          <button className="link" onClick={() => fileInput.current?.click()}>{t("import.manualFile")}</button>
          <input ref={fileInput} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
        </div>
      </div>

      {!empty && (
        <>
          <h3 className="step">
            {t("voice.intake.select")}
            <span className="using">{t("voice.intake.using", { n: String(selected.length), total: String(pieces.length) })}</span>
          </h3>
          <ul className="tiles">
            {pieces.map((p) => {
              const id = `piece-${p.key}`;
              const name = label(p);
              return (
                <li key={p.key} className={`tile ${p.selected ? "on" : "off"} ${p.editing ? "editing" : ""}`}>
                  <input id={id} type="checkbox" className="sr-only" checked={p.selected} onChange={(e) => patch(p.key, { selected: e.target.checked })} />
                  <label htmlFor={id} className="tile-body">
                    <span className="chk" aria-hidden="true">{p.selected ? "✓" : ""}</span>
                    <span className="t">{name}</span>
                    {!p.editing && <span className="x">{p.body.trim().slice(0, 140)}</span>}
                    <span className="s"><span className="badge">{t(`kind.${p.kind}` as const)}</span><span>{t("voice.intake.chars", { n: [...p.body.trim()].length.toLocaleString() })}</span></span>
                  </label>
                  {p.editing && (
                    <textarea aria-label={name} value={p.body} onChange={(e) => patch(p.key, { body: e.target.value })} placeholder={t("voice.intake.piecePlaceholder")} rows={6} autoFocus={p.kind === "paste"} />
                  )}
                  <span className="tile-actions">
                    <button className="link" onClick={() => patch(p.key, { editing: !p.editing })}>{p.editing ? t("action.done") : t("action.edit")}</button>
                    <button className="link" aria-label={`${t("action.remove")}: ${name}`} onClick={() => remove(p.key)}>{t("action.remove")}</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {error && <ErrorNote error={error} />}

      {!empty && (
        <div className="finish" role="region" aria-label={t("voice.intake.build")}>
          <div className="ready">
            <div>{readiness}
              {use.truncated > 0 && <> {t("ready.truncated", { n: String(use.truncated), per: budget.per_piece_chars.toLocaleString() })}</>}
              {use.dropped > 0 && <> {t("ready.dropped", { n: String(use.dropped) })}</>}
            </div>
            <div className="g">{t("ready.name", { name })}</div>
            <div className="pips" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} className={use.count >= (i + 1) * 2 ? "f" : ""} />)}</div>
          </div>
          <button className="btn pri" disabled={use.count === 0} onClick={() => onBuild(name, selected.map(({ kind, origin, body }) => ({ kind, origin, body })))}>
            {t("voice.intake.build")}
          </button>
        </div>
      )}
    </div>
  );
}
