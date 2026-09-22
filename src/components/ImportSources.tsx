import { useRef, useState } from "react";
import { host, type Imported, type Piece, type SourceKind, type UiError } from "../platform/host";
import { asUiError } from "../errors";
import { ErrorNote } from "./ErrorNote";
import { t } from "../i18n";

export type ImportedPiece = { kind: SourceKind; origin: string | null; title: string | null; body: string };

type Status = { kind: "idle" } | { kind: "working" } | { kind: "done"; result: Imported } | { kind: "error"; error: UiError };

function toPieces(kind: SourceKind, r: Imported): ImportedPiece[] {
  return r.pieces.map((p: Piece) => ({ kind, origin: p.url ?? null, title: p.title, body: p.text }));
}

export function ImportSources({ onImported }: { onImported: (pieces: ImportedPiece[]) => void }) {
  const [note, setNote] = useState("");
  const [medium, setMedium] = useState("");
  const [xReplies, setXReplies] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const xInput = useRef<HTMLInputElement>(null);

  const run = async (kind: SourceKind, fetch: () => Promise<Imported>) => {
    setStatus({ kind: "working" });
    try {
      const result = await fetch();
      onImported(toPieces(kind, result));
      setStatus({ kind: "done", result });
    } catch (e) {
      setStatus({ kind: "error", error: asUiError(e) });
    }
  };

  const onXFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const contents = await file.text();
    await run("x", () => host.importXArchive(contents, null, xReplies));
    if (xInput.current) xInput.current.value = "";
  };

  const busy = status.kind === "working";
  return (
    <div className="import">
      <h3>{t("import.title")}</h3>
      <p className="muted small">{t("import.lead")}</p>

      <form className="import-row" onSubmit={(e) => { e.preventDefault(); if (note.trim()) void run("note", () => host.importNote(note)); }}>
        <label htmlFor="import-note">{t("import.note")}</label>
        <input id="import-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("import.notePlaceholder")} disabled={busy} autoComplete="off" />
        <button type="submit" className="secondary" disabled={busy || !note.trim()}>{t("import.go")}</button>
      </form>
      <form className="import-row" onSubmit={(e) => { e.preventDefault(); if (medium.trim()) void run("medium", () => host.importMedium(medium)); }}>
        <label htmlFor="import-medium">{t("import.medium")}</label>
        <input id="import-medium" value={medium} onChange={(e) => setMedium(e.target.value)} placeholder={t("import.mediumPlaceholder")} disabled={busy} autoComplete="off" />
        <button type="submit" className="secondary" disabled={busy || !medium.trim()}>{t("import.go")}</button>
      </form>
      <div className="import-row">
        <span className="import-label">{t("import.x")}</span>
        <span className="muted small">{t("import.xHint")}</span>
        <label className="check"><input type="checkbox" checked={xReplies} onChange={(e) => setXReplies(e.target.checked)} /> {t("import.xReplies")}</label>
        <button className="secondary" disabled={busy} onClick={() => xInput.current?.click()}>{t("import.xPick")}</button>
        <input ref={xInput} type="file" accept=".js,.json,text/javascript,application/json" hidden onChange={(e) => void onXFile(e.target.files)} />
      </div>

      {status.kind === "working" && <p className="muted" role="status">{t("import.working")}</p>}
      {status.kind === "done" && (
        <p className="ok" role="status">
          {status.result.total != null
            ? t("import.resultTotal", { n: String(status.result.pieces.length), total: String(status.result.total) })
            : t("import.result", { n: String(status.result.pieces.length) })}
          {status.result.skipped_paid > 0 && <> {t("import.skippedPaid", { n: String(status.result.skipped_paid) })}</>}
          {status.result.recent_only && <> {t("import.recentOnly")}</>}
        </p>
      )}
      {status.kind === "error" && <ErrorNote error={status.error} />}
    </div>
  );
}
