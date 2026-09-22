import { useRef, useState } from "react";
import type { SourceInput, SourceKind } from "../platform/host";
import { ImportSources, type ImportedPiece } from "./ImportSources";
import { t } from "../i18n";

type Piece = { key: number; kind: SourceKind; origin: string | null; body: string };

let nextKey = 1;
const blank = (): Piece => ({ key: nextKey++, kind: "paste", origin: null, body: "" });

export function VoiceIntake({ onBuild, error }: { onBuild: (name: string, sources: SourceInput[]) => void; error?: string }) {
  const [name, setName] = useState("");
  const [pieces, setPieces] = useState<Piece[]>(() => [blank(), blank(), blank(), blank()]);
  const fileInput = useRef<HTMLInputElement>(null);

  const filled = pieces.filter((p) => p.body.trim().length > 0);
  const canBuild = name.trim().length > 0 && filled.length > 0;

  const update = (key: number, body: string) =>
    setPieces((ps) => ps.map((p) => (p.key === key ? { ...p, body } : p)));
  const remove = (key: number) => setPieces((ps) => (ps.length > 1 ? ps.filter((p) => p.key !== key) : ps));

  const addImported = (imported: ImportedPiece[]) =>
    setPieces((ps) => [
      ...ps.filter((p) => p.body.trim().length > 0 || p.kind !== "paste"),
      ...imported.map((p) => ({ key: nextKey++, ...p })),
    ]);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const read = await Promise.all(
      Array.from(files).map(async (f) => ({ key: nextKey++, kind: "file" as const, origin: f.name, body: await f.text() })),
    );
    setPieces((ps) => [...ps.filter((p) => p.body.trim().length > 0 || p.kind === "file"), ...read]);
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <div className="intake">
      <h2>{t("voice.intake.title")}</h2>
      <p className="muted">{t("voice.intake.lead")}</p>

      <ImportSources onImported={addImported} />

      <label className="field">
        <span>{t("voice.intake.name")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("voice.intake.namePlaceholder")} />
      </label>

      <ol className="pieces">
        {pieces.map((p, i) => (
          <li key={p.key} className="piece">
            <div className="piece-head">
              <span className="muted">{p.kind !== "paste" && p.origin ? p.origin : t("voice.intake.piece", { n: String(i + 1) })}</span>
              <button className="link" onClick={() => remove(p.key)}>{t("voice.intake.remove")}</button>
            </div>
            <textarea value={p.body} onChange={(e) => update(p.key, e.target.value)} placeholder={t("voice.intake.piecePlaceholder")} rows={3} />
          </li>
        ))}
      </ol>

      <div className="actions">
        <button className="secondary" onClick={() => setPieces((ps) => [...ps, blank()])}>{t("voice.intake.addPiece")}</button>
        <button className="secondary" onClick={() => fileInput.current?.click()}>{t("voice.intake.addFiles")}</button>
        <input ref={fileInput} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
        <span className="muted count">{t("voice.intake.count", { n: String(filled.length) })}</span>
      </div>

      {error && (
        <>
          <p className="warn">{t("voice.error")}</p>
          <pre>{error}</pre>
        </>
      )}

      <p className="muted small">{t("voice.intake.privacy")}</p>
      <button
        disabled={!canBuild}
        onClick={() => onBuild(name, filled.map(({ kind, origin, body }) => ({ kind, origin, body })))}
      >
        {t("voice.intake.build")}
      </button>
    </div>
  );
}
