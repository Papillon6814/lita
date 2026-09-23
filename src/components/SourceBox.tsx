import { useRef, useState } from "react";
import { host, type Imported, type SourceKind, type UiError } from "../platform/host";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { ErrorNote } from "./ErrorNote";

type Service = "note" | "medium" | "x";
type State = { kind: "idle" } | { kind: "working" } | { kind: "done"; added: number } | { kind: "error"; error: UiError };

export type Gathered = { kind: SourceKind; origin: string | null; account: string | null; title: string | null; body: string };

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
  /** Start on this service with this account filled in (refreshing a connection). */
  preset?: { service: Service; account: string };
  onGathered: (pieces: Gathered[], from: { kind: SourceKind; account: string | null }) => void;
};

// The one place writing enters Lita: a service import (note / Medium / X
// archive) or a pasted piece / text files. Shared by the intake and by the
// voice page's learning sources (#68).
export function SourceBox({ hero, known, preset, onGathered }: Props) {
  const [service, setService] = useState<Service>(preset?.service ?? "note");
  const [account, setAccount] = useState(preset?.account ?? "");
  const [xReplies, setXReplies] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const xInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const run = async (kind: SourceKind, key: string, fetch: () => Promise<Imported>) => {
    setState({ kind: "working" });
    try {
      const result = await fetch();
      const fresh = result.pieces.filter((p) => !p.url || !known?.has(p.url));
      onGathered(fresh.map((p) => ({ kind, origin: p.url, account: key, title: p.title, body: p.text })), { kind, account: key });
      setState({ kind: "done", added: fresh.length });
    } catch (e) {
      setState({ kind: "error", error: asUiError(e) });
    }
  };

  const submit = () => {
    const a = account.trim();
    if (!a) return;
    const key = accountKey(service, a);
    if (service === "note") void run("note", key, () => host.importNote(a));
    else if (service === "medium") void run("medium", key, () => host.importMedium(a));
  };

  const onXFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const contents = await f.text();
    await run("x", "archive", () => host.importXArchive(contents, null, xReplies));
    if (xInput.current) xInput.current.value = "";
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const read = await Promise.all(Array.from(files).map(async (f) => ({ kind: "file" as const, origin: f.name, account: null, title: f.name, body: await f.text() })));
    onGathered(read, { kind: "file", account: null });
    if (fileInput.current) fileInput.current.value = "";
  };

  const busy = state.kind === "working";
  return (
    <div className={hero ? "srcbox hero" : "srcbox"}>
      <div className="seg" role="tablist">
        {(["note", "medium", "x"] as Service[]).map((s) => (
          <button key={s} role="tab" aria-selected={service === s} className={service === s ? "on" : ""} onClick={() => setService(s)}>{t(`source.${s}` as const)}</button>
        ))}
      </div>
      {service === "x" ? (
        <div className="row wrap">
          <button className="btn pri" disabled={busy} onClick={() => xInput.current?.click()}>{t("import.xPick")}</button>
          <label className="check"><input type="checkbox" checked={xReplies} onChange={(e) => setXReplies(e.target.checked)} /> {t("import.xReplies")}</label>
          <input ref={xInput} type="file" accept=".js,.json,text/javascript,application/json" hidden onChange={(e) => void onXFile(e.target.files)} />
        </div>
      ) : (
        <form className="row" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label htmlFor="import-account" className="sr-only">{t(`source.${service}` as const)}</label>
          <input id="import-account" value={account} onChange={(e) => setAccount(e.target.value)} placeholder={service === "note" ? t("import.notePlaceholder") : t("import.mediumPlaceholder")} disabled={busy} autoComplete="off" />
          <button type="submit" className="btn pri" disabled={busy || !account.trim()}>{t("import.go")}</button>
        </form>
      )}
      <p className="hint" role="status">
        {state.kind === "working" ? t("import.working")
          : state.kind === "done" ? (state.added === 0 ? t("import.nothingNew") : t("import.result"))
          : (service === "note" ? t("import.noteHint") : service === "medium" ? t("import.mediumHint") : t("import.xHint"))}
      </p>
      {state.kind === "error" && <ErrorNote error={state.error} />}
      <div className="manual">
        <span>{t("import.manual")}</span>
        <button className="link" onClick={() => onGathered([{ kind: "paste", origin: null, account: null, title: null, body: "" }], { kind: "paste", account: null })}>{t("import.manualWrite")}</button>
        <button className="link" onClick={() => fileInput.current?.click()}>{t("import.manualFile")}</button>
        <input ref={fileInput} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
      </div>
    </div>
  );
}
