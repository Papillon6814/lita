import { useMemo, useRef, useState } from "react";
import { host, type SourceKind, type UiError, type Voice } from "../platform/host";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { ErrorNote } from "./ErrorNote";
import { SourceBox, connectionLabel, type Gathered } from "./SourceBox";
import { connectionsOf } from "./VoiceIntake";
import { PasteBox, type NewPiece } from "./PasteBox";

type Props = { voice: Voice; onChange: (v: Voice) => void; onRebuild: () => void };

// The writing a voice was built from (#68; called 学習ソース in the code
// only, "元にした文章" on screen): each connection (note account,
// Medium handle, X archive, pasted / files) with what it contributed. New
// articles can be pulled from a connection, a connection dropped, another
// added; relearning from the whole pile is a separate, explicit step.
export function VoiceSources({ voice, onChange, onRebuild }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const xInput = useRef<HTMLInputElement>(null);
  const [xFor, setXFor] = useState<string | null>(null);

  const hand = voice.voice_sources.filter((s) => s.kind === "paste" || s.kind === "file");
  const linked = voice.voice_sources.filter((s) => s.kind !== "paste" && s.kind !== "file");
  const connections = connectionsOf(linked);
  const known = useMemo(() => new Set(voice.voice_sources.map((s) => s.origin).filter((o): o is string => !!o)), [voice.voice_sources]);
  const newer = voice.voice_sources.some((s) => s.created_at > voice.updated_at);
  const learned = new Date(voice.updated_at).toLocaleDateString();

  const apply = async (label: string, work: () => Promise<Voice | null>) => {
    setBusy(label); setError(null); setNote(null);
    try { const v = await work(); if (v) onChange(v); }
    catch (e) { setError(asUiError(e)); }
    finally { setBusy(null); }
  };

  const add = (items: Gathered[]) => {
    void apply("add", async () => {
      const v = await host.addVoiceSources(voice.id, items.map(({ kind, origin, account, body }) => ({ kind, origin, account, body })));
      setNote(items.length === 0 ? t("import.nothingNew") : t("voice.sources.added", { n: String(items.length) }));
      return v;
    });
  };

  const refresh = (kind: SourceKind, account: string | null) => {
    if (kind === "x") { setXFor(account); xInput.current?.click(); return; }
    if (!account || (kind !== "note" && kind !== "medium")) return;
    void apply(`${kind}:${account}`, async () => {
      const r = kind === "note" ? await host.importNote(account) : await host.importMedium(account);
      const fresh = r.pieces.filter((p) => !p.url || !known.has(p.url));
      if (fresh.length === 0) { setNote(t("import.nothingNew")); return null; }
      const v = await host.addVoiceSources(voice.id, fresh.map((p) => ({ kind, origin: p.url, account, body: p.text })));
      setNote(t("voice.sources.added", { n: String(fresh.length) }));
      return v;
    });
  };

  const onXFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const contents = await f.text();
    if (xInput.current) xInput.current.value = "";
    void apply("x", async () => {
      const r = await host.importXArchive(contents, null, false);
      const fresh = r.pieces.filter((p) => !p.url || !known.has(p.url));
      if (fresh.length === 0) { setNote(t("import.nothingNew")); return null; }
      const v = await host.addVoiceSources(voice.id, fresh.map((p) => ({ kind: "x" as const, origin: p.url, account: xFor ?? "archive", body: p.text })));
      setNote(t("voice.sources.added", { n: String(fresh.length) }));
      return v;
    });
  };

  const addByHand = (items: NewPiece[]) => add(items.map((i) => ({ kind: i.kind, origin: i.origin, account: null, title: null, body: i.body })));

  // One piece out, by its own id: what a hand-entered row means by "外す".
  const removeOne = (id: string) => void apply(`rm:${id}`, () => host.removeVoiceSource(voice.id, id));

  const remove = (kind: SourceKind, account: string | null) => {
    if (!window.confirm(t("voice.sources.removeConfirm", { name: connectionLabel(kind, account) }))) return;
    void apply(`rm:${kind}:${account}`, () => host.removeVoiceSources(voice.id, kind, account));
  };

  const rebuild = () => {
    if (!window.confirm(t("voice.sources.rebuildConfirm"))) return;
    onRebuild();
  };

  return (
    <section className="sources">
      <div className="sources-head">
        <h3>{t("voice.sources.title")}</h3>
        <span className="muted small">{t("voice.sources.meta", { n: String(voice.voice_sources.length), date: learned })}</span>
        {newer && <span className="hint">{t("voice.sources.newer")}</span>}
        <button className={newer ? "btn pri sm" : "btn sm"} disabled={busy !== null || voice.voice_sources.length === 0} onClick={rebuild}>{t("voice.sources.rebuild")}</button>
      </div>
      <PasteBox
        pieces={hand.map((s) => ({ id: s.id, kind: s.kind === "file" ? "file" : "paste", origin: s.origin, body: s.body }))}
        total={voice.voice_sources.length}
        busy={busy !== null}
        onAdd={addByHand}
        onRemove={removeOne}
      />
      <p className="or">{t("intake.or")}</p>
      <section className="box connect-box" aria-label={t("intake.box.connect")}>
        <h3 className="box-head">{t("intake.box.connect")}</h3>
        <SourceBox known={known} connected={connections} onGathered={add} onRemove={remove} onRefresh={refresh} refreshing={busy} />
      </section>
      <input ref={xInput} type="file" accept=".js,.json,text/javascript,application/json" hidden onChange={(e) => void onXFile(e.target.files)} />
      {note && <p className="hint" role="status">{note}</p>}
      {error && <ErrorNote error={error} />}
    </section>
  );
}
