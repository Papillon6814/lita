import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { host, type Imported, type SourceKind, type UiError } from "../platform/host";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { mockScene } from "../platform/mock";
import { ErrorNote } from "./ErrorNote";

type Service = "note" | "medium" | "x";
// `working` carries the real count from `import-progress`; both null until the listing arrives.
type RowState =
  | { kind: "idle" }
  | { kind: "working"; done: number | null; total: number | null }
  | { kind: "done"; added: number }
  | { kind: "error"; error: UiError };

/** The spinner stays this long even when the import is instant, so it never flickers (X archives). */
const MIN_SPIN_MS = 600;

export type Gathered = { kind: SourceKind; origin: string | null; account: string | null; title: string | null; body: string };
export type Connected = { kind: SourceKind; account: string | null; count: number };

/** The account key a service import is filed under (#68): note account, Medium handle, "archive" for X. */
export function accountKey(service: Service, input: string) {
  if (service === "x") return "archive";
  return input.trim().replace(/^https?:\/\/[^/]+\//, "").replace(/^@/, "").split(/[/?#]/)[0] || input.trim();
}

/** How a connection is named on screen. */
export function connectionLabel(kind: SourceKind, account: string | null) {
  if (kind === "note") return t("voice.name.note", { account: account ?? "" });
  if (kind === "medium") return t("voice.name.medium", { account: account ?? "" });
  if (kind === "x") return t("voice.name.x");
  if (kind === "file") return t("voice.name.file");
  return t("voice.name.pasted");
}

type Props = {
  hero?: boolean;
  /** Origins already held, so re-importing a connection adds only what is new. */
  known?: Set<string>;
  /** What is connected already; each shows as a ticked row with its count. */
  connected: Connected[];
  onGathered: (pieces: Gathered[], from: { kind: SourceKind; account: string | null }) => void;
  onRemove: (kind: SourceKind, account: string | null) => void;
  /** Pull new articles from a connection (voice page). Absent on the intake, where everything is new anyway. */
  onRefresh?: (kind: SourceKind, account: string | null) => void;
  refreshing?: string | null;
  /** Bump to unfold the first row: the intake's primary button, pressed with no material yet. */
  openFirst?: number;
};

// The one place writing enters Lita, as a row per place it can come from:
// note, Medium, an X archive, and by hand. A connected place is a ticked
// row; the others are folded to one line (name + hint) that opens its
// input on click, so the box reads as "any one of these is enough" rather
// than a four-field form (2026-09-23). Shared by the intake and by the
// voice page's learning sources.
export function SourceBox({ hero, known, connected, onGathered, onRemove, onRefresh, refreshing, openFirst }: Props) {
  const [inputs, setInputs] = useState<Record<Service, string>>({ note: "", medium: "", x: "" });
  const [rows, setRows] = useState<Partial<Record<Service, RowState>>>({});
  // The one folded row opened by hand; a row that is fetching or has something to say stays open on its own.
  const [open, setOpen] = useState<Service | null>(mockScene() === "intake-open" ? "note" : null);
  const [xReplies, setXReplies] = useState(false);
  useEffect(() => { if (openFirst) setOpen("note"); }, [openFirst]);
  const xInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // The real count of an import, as the native side reads piece by piece.
  // Only a row that is still working takes it, so a late event cannot revive a finished row.
  const listening = useRef<Promise<unknown> | null>(null);
  useEffect(() => {
    let stop: (() => void) | null = null;
    let gone = false;
    const sub = host.onImportProgress((p) => {
      setRows((r) => {
        const s = r[p.kind];
        if (!s || s.kind !== "working") return r;
        return { ...r, [p.kind]: { kind: "working", done: p.done, total: p.total } };
      });
    });
    listening.current = sub;
    void sub.then((un) => { if (gone) un(); else stop = un; });
    return () => { gone = true; stop?.(); };
  }, []);

  // The mock's connecting scene: start a note import on its own, since a screenshot cannot click.
  useEffect(() => {
    if (mockScene() !== "intake-connecting") return;
    setInputs((i) => ({ ...i, note: "kuno" }));
    setOpen("note");
    // Wait for the progress listener, or the import would start before anything is counting.
    let gone = false;
    void listening.current?.then(() => { if (!gone) void run("note", "note", "kuno", () => host.importNote("kuno")); });
    return () => { gone = true; };
  }, []);

  const run = async (service: Service, kind: SourceKind, key: string, fetch: () => Promise<Imported>) => {
    setRows((r) => ({ ...r, [service]: { kind: "working", done: null, total: null } }));
    // The button that was pressed is now disabled; keep the keyboard inside the row.
    requestAnimationFrame(() => document.getElementById(`src-row-${service}`)?.focus());
    const started = Date.now();
    const settle = async () => { const left = MIN_SPIN_MS - (Date.now() - started); if (left > 0) await new Promise((r) => setTimeout(r, left)); };
    try {
      const result = await fetch();
      await settle();
      const fresh = result.pieces.filter((p) => !p.url || !known?.has(p.url));
      onGathered(fresh.map((p) => ({ kind, origin: p.url, account: key, title: p.title, body: p.text })), { kind, account: key });
      // A ticked row is the result; only "nothing new" needs saying, and that keeps the row open.
      setRows((r) => ({ ...r, [service]: fresh.length === 0 ? { kind: "done", added: 0 } : { kind: "idle" } }));
      setInputs((i) => ({ ...i, [service]: "" }));
      setOpen(null);
    } catch (e) {
      await settle();
      setRows((r) => ({ ...r, [service]: { kind: "error", error: asUiError(e) } }));
      // The account stays in the box; put the keyboard back on it to try again.
      requestAnimationFrame(() => document.getElementById(`src-${service}`)?.focus());
    }
  };

  const submit = (service: "note" | "medium") => {
    const a = inputs[service].trim();
    if (!a) return;
    const key = accountKey(service, a);
    void run(service, service, key, () => (service === "note" ? host.importNote(a) : host.importMedium(a)));
  };

  const onXFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const contents = await f.text();
    if (xInput.current) xInput.current.value = "";
    await run("x", "x", "archive", () => host.importXArchive(contents, null, xReplies));
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const read = await Promise.all(Array.from(files).map(async (f) => ({ kind: "file" as const, origin: f.name, account: null, title: f.name, body: await f.text() })));
    onGathered(read, { kind: "file", account: null });
    if (fileInput.current) fileInput.current.value = "";
  };

  const of = (kind: SourceKind) => connected.filter((c) => c.kind === kind);
  const tick = (c: Connected) => {
    const key = `${c.kind}:${c.account}`;
    return (
      <div key={key} className="srcrow on">
        <span className="src-label" aria-hidden="true">✓</span>
        <span className="src-body"><span className="conn-name">{connectionLabel(c.kind, c.account)}</span> <span className="muted">{t("voice.sources.count", { n: String(c.count) })}</span></span>
        <span className="src-actions">
          {onRefresh && c.kind !== "paste" && c.kind !== "file" && (
            <button className="link" disabled={refreshing !== null && refreshing !== undefined} onClick={() => onRefresh(c.kind, c.account)}>
              {refreshing === key ? t("import.working") : c.kind === "x" ? t("voice.sources.refreshX") : t("voice.sources.refresh")}
            </button>
          )}
          <button className="link" onClick={() => onRemove(c.kind, c.account)}>{t("voice.sources.remove")}</button>
        </span>
      </div>
    );
  };
  // One sentence, ending in a verb; the count rides along only while it is known.
  const workingLine = (service: Service, s: { done: number | null; total: number | null }) => {
    if (service === "x") return t("import.readingArchive");
    if (s.done === null) return service === "note" ? t("import.listing") : t("import.readingArticles");
    if (s.total === null) return t("import.readingArticles");
    return t("import.readingArticlesN", { done: String(s.done), total: String(s.total) });
  };
  const status = (service: Service, hint: string) => {
    const s = rows[service];
    if (!s || s.kind === "idle") return <span className="src-hint">{hint}</span>;
    if (s.kind === "working")
      return (
        <span className="src-working">
          <span className="spinner" aria-hidden="true" />
          <span className="src-hint" role="status" aria-live="polite">{workingLine(service, s)}</span>
        </span>
      );
    if (s.kind === "done") return <span className="src-hint" role="status">{s.added === 0 ? t("import.nothingNew") : t("import.result")}</span>;
    return <ErrorNote error={s.error} />;
  };
  const busy = (service: Service) => rows[service]?.kind === "working";
  const expanded = (service: Service) => open === service || (rows[service] !== undefined && rows[service]?.kind !== "idle");

  // Folding a row back: focus returns to the row so keyboard users keep their place.
  // A row that is fetching does not fold, so the work never disappears from view.
  const close = (service: Service) => {
    if (busy(service)) return;
    setOpen(null);
    setRows((r) => ({ ...r, [service]: { kind: "idle" } }));
    requestAnimationFrame(() => document.getElementById(`src-row-${service}`)?.focus());
  };
  const onKey = (service: Service) => (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(service); } };
  const lite = (service: Service, name: string, hint: string) => (
    <button type="button" id={`src-row-${service}`} className="srcrow lite" aria-expanded={false} aria-controls={`src-${service}`} onClick={() => setOpen(service)}>
      <span className="src-label">{name}</span>
      <span className="src-hint">{hint}</span>
    </button>
  );
  const toggle = (service: Service, name: string) => (
    <button type="button" id={`src-row-${service}`} className="src-label src-toggle" aria-expanded={true} aria-disabled={busy(service)} aria-controls={`src-${service}`} onClick={() => close(service)}>{name}</button>
  );
  // While a row fetches, its button says what pressing it does next; after a failure, that is trying again.
  const connectLabel = (service: Service) => (rows[service]?.kind === "error" ? t("import.retry") : t("import.connect"));

  return (
    <div className={hero ? "srcbox hero" : "srcbox"}>
      {of("note").map(tick)}
      {of("note").length === 0 && (expanded("note") ? (
        <form className="srcrow open" aria-busy={busy("note")} onSubmit={(e) => { e.preventDefault(); submit("note"); }} onKeyDown={onKey("note")}>
          {toggle("note", t("source.note"))}
          <span className="src-body">
            <input id="src-note" aria-label={t("source.note")} value={inputs.note} onChange={(e) => setInputs((i) => ({ ...i, note: e.target.value }))} placeholder={t("import.notePlaceholder")} disabled={busy("note")} autoComplete="off" autoFocus />
            {status("note", t("import.noteHint"))}
          </span>
          <span className="src-actions"><button type="submit" className="btn sm" disabled={busy("note") || !inputs.note.trim()}>{connectLabel("note")}</button></span>
        </form>
      ) : lite("note", t("source.note"), t("import.noteHint")))}
      {of("medium").map(tick)}
      {of("medium").length === 0 && (expanded("medium") ? (
        <form className="srcrow open" aria-busy={busy("medium")} onSubmit={(e) => { e.preventDefault(); submit("medium"); }} onKeyDown={onKey("medium")}>
          {toggle("medium", t("source.medium"))}
          <span className="src-body">
            <input id="src-medium" aria-label={t("source.medium")} value={inputs.medium} onChange={(e) => setInputs((i) => ({ ...i, medium: e.target.value }))} placeholder={t("import.mediumPlaceholder")} disabled={busy("medium")} autoComplete="off" autoFocus />
            {status("medium", t("import.mediumHint"))}
          </span>
          <span className="src-actions"><button type="submit" className="btn sm" disabled={busy("medium") || !inputs.medium.trim()}>{connectLabel("medium")}</button></span>
        </form>
      ) : lite("medium", t("source.medium"), t("import.mediumHint")))}
      {of("x").map(tick)}
      {of("x").length === 0 && (expanded("x") ? (
        <div className="srcrow open" id="src-x" aria-busy={busy("x")} onKeyDown={onKey("x")}>
          {toggle("x", t("source.x"))}
          <span className="src-body">
            <span className="row wrap">
              <button className="btn sm" disabled={busy("x")} onClick={() => xInput.current?.click()} autoFocus>{t("import.xPick")}</button>
              <label className="check"><input type="checkbox" checked={xReplies} onChange={(e) => setXReplies(e.target.checked)} /> {t("import.xReplies")}</label>
            </span>
            {status("x", t("import.xHint"))}
          </span>
        </div>
      ) : lite("x", t("source.x"), t("import.xHint")))}
      <input ref={xInput} type="file" accept=".js,.json,text/javascript,application/json" hidden onChange={(e) => void onXFile(e.target.files)} />
      {of("paste").map(tick)}
      {of("file").map(tick)}
      <div className="srcrow hand">
        <span className="src-label">{t("import.manual")}</span>
        <span className="src-body manual">
          <button className="link" onClick={() => onGathered([{ kind: "paste", origin: null, account: null, title: null, body: "" }], { kind: "paste", account: null })}>{t("import.manualWrite")}</button>
          <button className="link" onClick={() => fileInput.current?.click()}>{t("import.manualFile")}</button>
          <input ref={fileInput} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
        </span>
      </div>
    </div>
  );
}
