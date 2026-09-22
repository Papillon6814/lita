import { useRef, useState } from "react";
import { host, type Imported, type Piece, type SourceKind } from "../platform/host";
import { t } from "../i18n";

export type ImportedPiece = { kind: SourceKind; origin: string | null; body: string };

type Status = { kind: "idle" } | { kind: "working" } | { kind: "done"; result: Imported } | { kind: "error"; message: string };

function toPieces(kind: SourceKind, r: Imported): ImportedPiece[] {
  return r.pieces.map((p: Piece) => ({ kind, origin: p.url ?? p.title, body: p.text }));
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
      setStatus({ kind: "error", message: String(e) });
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

      <div className="import-row">
        <label>{t("import.note")}</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("import.notePlaceholder")} disabled={busy} />
        <button className="secondary" disabled={busy || !note.trim()} onClick={() => void run("note", () => host.importNote(note))}>{t("import.go")}</button>
      </div>
      <div className="import-row">
        <label>{t("import.medium")}</label>
        <input value={medium} onChange={(e) => setMedium(e.target.value)} placeholder={t("import.mediumPlaceholder")} disabled={busy} />
        <button className="secondary" disabled={busy || !medium.trim()} onClick={() => void run("medium", () => host.importMedium(medium))}>{t("import.go")}</button>
      </div>
      <div className="import-row">
        <label>{t("import.x")}</label>
        <span className="muted small">{t("import.xHint")}</span>
        <label className="check"><input type="checkbox" checked={xReplies} onChange={(e) => setXReplies(e.target.checked)} /> {t("import.xReplies")}</label>
        <button className="secondary" disabled={busy} onClick={() => xInput.current?.click()}>{t("import.xPick")}</button>
        <input ref={xInput} type="file" accept=".js,.json,text/javascript,application/json" hidden onChange={(e) => void onXFile(e.target.files)} />
      </div>

      {status.kind === "working" && <p className="muted">{t("import.working")}</p>}
      {status.kind === "done" && (
        <p className="ok">
          {status.result.total != null
            ? t("import.resultTotal", { n: String(status.result.pieces.length), total: String(status.result.total) })
            : t("import.result", { n: String(status.result.pieces.length) })}
          {status.result.skipped_paid > 0 && <> {t("import.skippedPaid", { n: String(status.result.skipped_paid) })}</>}
          {status.result.recent_only && <> {t("import.recentOnly")}</>}
        </p>
      )}
      {status.kind === "error" && (
        <>
          <p className="warn">{t("import.error")}</p>
          <pre>{status.message}</pre>
        </>
      )}
    </div>
  );
}
