import { useEffect, useRef, useState, type DragEvent } from "react";
import { t } from "../i18n";

// The box where writing enters by hand (2026-09-23, "手で入れる文章を、つなぐ
// 連携と完全に分ける"). Case A: the field is the lead. It is open from the
// start, at the top of the box; what was added piles up below it, one line per
// piece, unfolded, because the one thing worth checking here is whether the
// split is right. Connected writing keeps its own box and stays folded.

export type ManualKind = "paste" | "file";
/** A piece already in: `id` is the row's identity (a local key, or a voice_sources id). */
export type ManualPiece = { id: string; kind: ManualKind; origin: string | null; body: string };
export type NewPiece = { kind: ManualKind; origin: string | null; body: string };

const TITLE_CHARS = 60;

/**
 * How pasted text becomes pieces: a blank line (any number in a row counts
 * once) or a line of dashes on its own ends a piece. No separator means one
 * piece. Edges are trimmed and empty pieces are dropped.
 */
export function splitPasted(text: string): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => { const s = buf.join("\n").trim(); if (s) out.push(s); buf = []; };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "" || /^-{3,}$/.test(line)) flush();
    else buf.push(raw);
  }
  flush();
  return out;
}

/** What a row is called: a file keeps its name, anything else shows its first line. */
export function pieceTitle(piece: { kind: ManualKind; origin: string | null; body: string }) {
  if (piece.kind === "file" && piece.origin) return piece.origin;
  const first = piece.body.trim().split("\n")[0] ?? "";
  return first ? [...first].slice(0, TITLE_CHARS).join("") : t("voice.intake.untitled");
}

const TEXT_FILE = /\.(txt|md|markdown)$/i;

type Props = {
  /** The pieces entered by hand, in the order they went in. */
  pieces: ManualPiece[];
  /** Everything the voice will be built from, so the "four is steadier" line knows when to go quiet. */
  total: number;
  onAdd: (items: NewPiece[]) => void;
  onRemove: (id: string) => void;
  /** Editing a piece in place. Absent on the voice page, where a row is only removed. */
  onEdit?: (id: string, body: string) => void;
  /** Joining a row with the one above it. Absent on the voice page. */
  onMerge?: (id: string) => void;
  busy?: boolean;
  /** Bump to put the keyboard in the field: the primary button, pressed with nothing in yet. */
  focus?: number;
};

export function PasteBox({ pieces, total, onAdd, onRemove, onEdit, onMerge, busy, focus }: Props) {
  const [text, setText] = useState("");
  // Pressed "make it one": the paste is taken whole. Pressing again splits it back.
  const [merged, setMerged] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const depth = useRef(0);

  useEffect(() => { if (focus) area.current?.focus(); }, [focus]);

  const parts = splitPasted(text);
  const ready = merged ? (text.trim() ? [text.trim()] : []) : parts;
  // Silent for a single piece: there is nothing to check when nothing was split.
  const showCount = parts.length > 1 || (merged && parts.length > 0);

  const add = () => {
    if (ready.length === 0) return;
    onAdd(ready.map((body) => ({ kind: "paste" as const, origin: null, body })));
    setText("");
    setMerged(false);
    area.current?.focus();
  };

  // One file is one piece: a file was already cut by whoever wrote it, so the
  // blank lines inside it are paragraphs, not seams.
  const take = async (files: File[]) => {
    const wanted = files.filter((f) => TEXT_FILE.test(f.name) || f.type.startsWith("text/"));
    if (wanted.length === 0) return;
    const read = await Promise.all(wanted.map(async (f) => ({ kind: "file" as const, origin: f.name, body: await f.text() })));
    onAdd(read.filter((p) => p.body.trim().length > 0));
  };

  const filePick = useRef<HTMLInputElement>(null);
  const onPick = async (list: FileList | null) => {
    if (list) await take(Array.from(list));
    if (filePick.current) filePick.current.value = "";
  };

  const dragged = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const onDragOver = (e: DragEvent) => { if (!dragged(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; };
  const onDragEnter = (e: DragEvent) => { if (!dragged(e)) return; e.preventDefault(); depth.current++; setOver(true); };
  const onDragLeave = (e: DragEvent) => { if (!dragged(e)) return; depth.current--; if (depth.current <= 0) { depth.current = 0; setOver(false); } };
  const onDrop = (e: DragEvent) => {
    if (!dragged(e)) return;
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    void take(Array.from(e.dataTransfer.files));
  };

  return (
    <section
      className={over ? "box paste-box over" : "box paste-box"}
      aria-label={t("intake.box.paste")}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <h3 className="box-head">{t("intake.box.paste")}</h3>
      <textarea
        ref={area}
        className="paste-area"
        aria-label={t("intake.box.paste")}
        rows={5}
        value={text}
        placeholder={t("paste.placeholder")}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
      />
      {showCount && (
        <p className="count-line">
          <span role="status">{t("paste.count", { n: String(ready.length) })}</span>
          <button className="link" onClick={() => setMerged((m) => !m)}>
            {merged ? t("paste.splitBack", { n: String(parts.length) }) : t("paste.mergeAll")}
          </button>
        </p>
      )}

      {pieces.length > 0 && (
        <ul className="plist">
          {pieces.map((p, i) => {
            const title = pieceTitle(p);
            const open = editing === p.id;
            return (
              <li key={p.id} className={open ? "prow open" : "prow"}>
                <span className="p-title">{title}</span>
                <span className="p-actions">
                  {onMerge && i > 0 && !open && (
                    <button className="link quiet-link" onClick={() => onMerge(p.id)}>{t("paste.mergePrev")}</button>
                  )}
                  {onEdit && (
                    <button className="link" aria-expanded={open} onClick={() => setEditing(open ? null : p.id)}>
                      {open ? t("action.done") : t("action.fix")}
                    </button>
                  )}
                  <button className="link" aria-label={`${t("action.remove")}: ${title}`} onClick={() => { if (open) setEditing(null); onRemove(p.id); }}>
                    {t("action.remove")}
                  </button>
                </span>
                {open && onEdit && (
                  <textarea className="p-edit" aria-label={title} rows={6} autoFocus value={p.body} onChange={(e) => onEdit(p.id, e.target.value)} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="sr-only" role="status">{t("paste.list", { n: String(pieces.length) })}</p>
      {total > 0 && total < 4 && <p className="box-hint">{t("paste.more")}</p>}

      <div className="box-foot">
        <button className="btn sm" disabled={busy || ready.length === 0} onClick={add}>{t("paste.add")}</button>
        <span className="grow" />
        <button className="link quiet-link" disabled={busy} onClick={() => filePick.current?.click()}>{t("import.manualFile")}</button>
        <span className="src-hint">{t("paste.dropHint")}</span>
        <input ref={filePick} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" multiple hidden onChange={(e) => void onPick(e.target.files)} />
      </div>
    </section>
  );
}
