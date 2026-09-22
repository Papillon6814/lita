import { useEffect, useMemo, useRef, useState } from "react";
import { host, type MaterialBudget, type SourceInput, type SourceKind, type UiError } from "../platform/host";
import { ImportSources, type ImportedPiece } from "./ImportSources";
import { ErrorNote } from "./ErrorNote";
import { t } from "../i18n";

type Piece = {
  key: number;
  kind: SourceKind;
  origin: string | null;
  title: string | null;
  body: string;
  selected: boolean;
  editing: boolean;
};

let nextKey = 1;
const manual = (): Piece => ({ key: nextKey++, kind: "paste", origin: null, title: null, body: "", selected: true, editing: true });

// Mirrors lita_codex::voice::select_material so the usage line matches what
// the native side will actually send (R-1). The numbers come from the app.
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

function label(p: Piece): string {
  if (p.title) return p.title;
  if (p.kind === "file" && p.origin) return p.origin;
  const first = p.body.trim().split("\n")[0] ?? "";
  return first ? [...first].slice(0, 48).join("") : t("voice.intake.untitled");
}

export function VoiceIntake({ onBuild, error }: { onBuild: (name: string, sources: SourceInput[]) => void; error?: UiError }) {
  const [name, setName] = useState("");
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [budget, setBudget] = useState<MaterialBudget>({ per_piece_chars: 1500, total_chars: 20000 });
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void host.materialBudget().then(setBudget).catch(() => {});
  }, []);

  const selected = pieces.filter((p) => p.selected && p.body.trim().length > 0);
  const use = useMemo(() => usage(selected, budget), [selected, budget]);
  const canBuild = name.trim().length > 0 && use.count > 0;

  const patch = (key: number, change: Partial<Piece>) =>
    setPieces((ps) => ps.map((p) => (p.key === key ? { ...p, ...change } : p)));
  const remove = (key: number) => setPieces((ps) => ps.filter((p) => p.key !== key));
  const setAll = (selected: boolean) => setPieces((ps) => ps.map((p) => ({ ...p, selected })));

  const addImported = (imported: ImportedPiece[]) =>
    setPieces((ps) => [...ps, ...imported.map((p) => ({ key: nextKey++, selected: true, editing: false, ...p }))]);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const read = await Promise.all(
      Array.from(files).map(async (f) => ({
        key: nextKey++, kind: "file" as const, origin: f.name, title: f.name, body: await f.text(), selected: true, editing: false,
      })),
    );
    setPieces((ps) => [...ps, ...read]);
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <div className="intake">
      <h2>{t("voice.intake.title")}</h2>
      <p className="muted">{t("voice.what")}</p>

      <h3 className="step">{t("voice.intake.sources")}</h3>
      <ImportSources onImported={addImported} />
      <div className="actions">
        <button className="secondary" onClick={() => setPieces((ps) => [...ps, manual()])}>{t("voice.intake.addManual")}</button>
        <button className="secondary" onClick={() => fileInput.current?.click()}>{t("voice.intake.addFiles")}</button>
        <input ref={fileInput} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
      </div>

      <h3 className="step">{t("voice.intake.select")}</h3>
      {pieces.length === 0 ? (
        <p className="muted small">{t("voice.intake.empty")}</p>
      ) : (
        <>
          <div className="actions small">
            <button className="link" onClick={() => setAll(true)}>{t("voice.intake.selectAll")}</button>
            <button className="link" onClick={() => setAll(false)}>{t("voice.intake.selectNone")}</button>
            <span className="muted count">{t("voice.intake.count", { n: String(selected.length) })}</span>
          </div>
          <ul className="candidates">
            {pieces.map((p, i) => {
              const id = `piece-${p.key}`;
              const name = label(p);
              return (
                <li key={p.key} className={p.selected ? "candidate" : "candidate off"}>
                  <div className="candidate-row">
                    <input id={id} type="checkbox" checked={p.selected} onChange={(e) => patch(p.key, { selected: e.target.checked })} />
                    <label htmlFor={id} className="candidate-label">
                      <span className="candidate-title">{name}</span>
                      <span className="muted small">
                        <span className="badge">{t(`kind.${p.kind}` as const)}</span> {t("voice.intake.chars", { n: String([...p.body.trim()].length) })}
                      </span>
                    </label>
                    <button className="link" aria-expanded={p.editing} aria-controls={`${id}-body`} onClick={() => patch(p.key, { editing: !p.editing })}>
                      {p.editing ? t("voice.intake.collapse") : t("voice.intake.expand")}
                    </button>
                    <button className="link" aria-label={`${t("voice.intake.remove")}: ${name}`} onClick={() => remove(p.key)}>{t("voice.intake.remove")}</button>
                  </div>
                  {p.editing && (
                    <textarea
                      id={`${id}-body`}
                      aria-label={t("voice.intake.piece", { n: String(i + 1) })}
                      value={p.body}
                      onChange={(e) => patch(p.key, { body: e.target.value })}
                      placeholder={t("voice.intake.piecePlaceholder")}
                      rows={p.kind === "paste" ? 4 : 8}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          <p className="muted small" aria-live="polite">
            {t("voice.intake.usage", { pieces: String(use.count), chars: use.chars.toLocaleString(), total: budget.total_chars.toLocaleString() })}
            {use.truncated > 0 && <> {t("voice.intake.usageTruncated", { n: String(use.truncated), per: budget.per_piece_chars.toLocaleString() })}</>}
            {use.dropped > 0 && <> {t("voice.intake.usageDropped", { n: String(use.dropped) })}</>}
          </p>
        </>
      )}

      <h3 className="step">{t("voice.intake.finish")}</h3>
      {error && <ErrorNote error={error} />}
      <div className="finish-row">
        <label className="field grow">
          <span>{t("voice.intake.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("voice.intake.namePlaceholder")} autoComplete="off" />
        </label>
        <button
          disabled={!canBuild}
          onClick={() => onBuild(name, selected.map(({ kind, origin, body }) => ({ kind, origin, body })))}
        >
          {t("voice.intake.build")}
        </button>
      </div>
    </div>
  );
}
