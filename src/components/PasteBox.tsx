import { Fragment, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { host, type TalkReading } from "../platform/host";
import { mockTalkMe, mockTalkPaste } from "../platform/mock";
import { detectLocale, t } from "../i18n";

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

/** Marks a piece kept from a pasted conversation (D-77): `talk:YYYY-MM-DD`, the day it was pasted. No tool is named. */
const TALK = "talk:";
/** The names this device knows to be you in a pasted conversation. Never sent anywhere. */
const ME_KEY = "lita.talk.me";
/** How many names are remembered; the one used longest ago goes first. */
const ME_MAX = 5;

const rememberedMe = (): string[] => {
  const seeded = mockTalkMe();
  if (seeded) return seeded;
  try { const v = JSON.parse(localStorage.getItem(ME_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
};
const saveMe = (names: string[]) => { try { localStorage.setItem(ME_KEY, JSON.stringify(names)); } catch {} };
const rememberMe = (name: string) => saveMe([...rememberedMe().filter((n) => n !== name), name].slice(-ME_MAX));
const forgetMe = (name: string) => saveMe(rememberedMe().filter((n) => n !== name));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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

/** The bodies kept from conversations before, for `knownTalk`. */
export const talkBodies = (pieces: { origin: string | null; body: string }[]) =>
  pieces.filter((p) => p.origin?.startsWith(TALK)).map((p) => p.body);

/** What a row is called: a file keeps its name, anything else shows its first line. */
export function pieceTitle(piece: { kind: ManualKind; origin: string | null; body: string }) {
  if (piece.kind === "file" && piece.origin) return piece.origin;
  // Kept from a conversation: "your messages" and the day, not its first line.
  if (piece.origin?.startsWith(TALK)) {
    const [y, m, d] = piece.origin.slice(TALK.length).split("-").map(Number);
    const day = new Date(y, m - 1, d);
    const date = Number.isNaN(day.getTime()) ? piece.origin.slice(TALK.length) : day.toLocaleDateString(detectLocale(), { month: "long", day: "numeric" });
    return t("voice.name.talk", { date });
  }
  const first = piece.body.trim().split("\n")[0] ?? "";
  return first ? [...first].slice(0, TITLE_CHARS).join("") : t("voice.intake.untitled");
}

const TEXT_FILE = /\.(txt|md|markdown)$/i;

type Props = {
  /** The pieces entered by hand, in the order they went in. */
  pieces: ManualPiece[];
  /** Everything the voice will be built from, so the "four is steadier" line knows when to go quiet. */
  total: number;
  /** A promise that rejects keeps what was pasted in the field, to try again. */
  onAdd: (items: NewPiece[]) => void | Promise<void>;
  onRemove: (id: string) => void;
  /** Editing a piece in place. Absent on the voice page, where a row is only removed. */
  onEdit?: (id: string, body: string) => void;
  /** Joining a row with the one above it. Absent on the voice page. */
  onMerge?: (id: string) => void;
  busy?: boolean;
  /** Bump to put the keyboard in the field: the primary button, pressed with nothing in yet. */
  focus?: number;
  /**
   * Bodies already added from conversations, so a message is not added twice.
   * Undefined while they are still being read.
   */
  knownTalk?: string[];
};

/**
 * Where a pasted conversation stands. "who": choosing which name is you
 * (`was`: the name chosen before "choose again", forgotten if another is
 * chosen). "kept": the field holds your messages only (`shown` is that text,
 * so an edit is noticed). "none" / "allIn": nothing of yours is left to add.
 */
type Talk =
  | { step: "who"; was?: string | null }
  | { step: "kept"; me: string | null; partial: boolean; shown: string }
  | { step: "none" }
  | { step: "allIn" };

export function PasteBox({ pieces, total, onAdd, onRemove, onEdit, onMerge, busy, focus, knownTalk }: Props) {
  const [text, setText] = useState("");
  // Pressed "make it one": the paste is taken whole. Pressing again splits it back.
  const [merged, setMerged] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const depth = useRef(0);

  // A pasted conversation (D-77). What was pasted, other people's messages
  // included, lives only here, in memory, so the person can choose again
  // without pasting again. It never reaches the field, storage or Codex, and
  // goes as soon as the piece is added, the field is emptied or the box closes.
  const [talk, setTalk] = useState<Talk | null>(null);
  const [unsure, setUnsure] = useState(false);
  const pasted = useRef<{ raw: string; reading: Extract<TalkReading, { kind: "talk" }> } | null>(null);
  const reads = useRef(0);
  const firstName = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (focus) area.current?.focus(); }, [focus]);
  useEffect(() => { if (talk?.step === "who") firstName.current?.focus(); }, [talk?.step]);

  const parts = splitPasted(text);
  const ready = merged ? (text.trim() ? [text.trim()] : []) : parts;
  const kept = talk?.step === "kept";
  // Silent for a single piece: there is nothing to check when nothing was split.
  const showCount = !talk && (parts.length > 1 || (merged && parts.length > 0));

  const forgetTalk = () => { pasted.current = null; setTalk(null); setUnsure(false); };

  // Fills the field with the messages of `me` that are not in yet.
  const keep = (me: string | null) => {
    const reading = pasted.current?.reading;
    if (!reading) return;
    // Chosen again: the name chosen before was not you, so it is not remembered either.
    if (talk?.step === "who" && typeof talk.was === "string" && talk.was !== me) forgetMe(talk.was);
    const mine = reading.messages.filter((m) => m.speaker === me);
    const fresh = mine.filter((m) => !m.seen);
    if (fresh.length === 0) {
      pasted.current = null;
      setText("");
      setTalk({ step: mine.length > 0 ? "allIn" : "none" });
      return;
    }
    const body = fresh.map((m) => m.body).join("\n\n");
    setText(body);
    setTalk({ step: "kept", me, partial: fresh.length < mine.length, shown: body });
  };

  // "All of it is mine": back to an ordinary paste, as it was copied.
  const allMine = () => {
    const raw = pasted.current?.raw ?? "";
    forgetTalk();
    setText(raw);
    setMerged(false);
    requestAnimationFrame(() => area.current?.focus());
  };

  const cancelTalk = () => {
    forgetTalk();
    setText("");
    requestAnimationFrame(() => area.current?.focus());
  };

  // Reads what was pasted on this machine. A conversation keeps its speakers'
  // messages in memory and shows yours; anything else goes in as it was.
  const readPaste = async (clip: string) => {
    const onTalk = talk?.step === "kept" && text === talk.shown && pasted.current;
    const raw = onTalk ? `${pasted.current!.raw}\n\n${clip}` : clip;
    const asPlain = onTalk ? `${text}\n\n${clip}` : clip;
    const run = ++reads.current;
    let reading: TalkReading;
    try { reading = await host.readTalk(raw, knownTalk ?? []); } catch { reading = { kind: "plain" }; }
    if (run !== reads.current) return;
    if (reading.kind !== "talk") {
      forgetTalk();
      setUnsure(reading.kind === "unsure");
      setText(asPlain);
      setMerged(false);
      return;
    }
    pasted.current = { raw, reading };
    setUnsure(false);
    const hasUnnamed = reading.messages.some((m) => m.speaker === null);
    // Pasting more onto a conversation keeps the one already chosen. Otherwise
    // a name this device remembers is you; with none, the person is asked,
    // even when there is one name only (it may be someone else's). Two or
    // more remembered names in one conversation cannot both be you: asked too.
    const before = onTalk && talk?.step === "kept" ? talk.me : undefined;
    const known = reading.speakers.filter((s) => rememberedMe().includes(s));
    const me = before !== undefined && (before === null ? hasUnnamed : reading.speakers.includes(before))
      ? before
      : known.length === 1 ? known[0] : undefined;
    if (me !== undefined) keep(me);
    else { setText(""); setTalk({ step: "who" }); }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const clip = e.clipboardData.getData("text/plain");
    if (!clip.trim()) return;
    // Only into an empty field, or onto a conversation as it was shown:
    // pasting into one's own writing is ordinary pasting.
    const onTalk = talk?.step === "kept" && text === talk.shown;
    if (text.trim() !== "" && !onTalk) return;
    e.preventDefault();
    void readPaste(clip);
  };

  // The mock's talk scenes start as if a conversation had just been pasted.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || knownTalk === undefined) return;
    const sample = mockTalkPaste();
    if (!sample) return;
    seeded.current = true;
    void readPaste(sample);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownTalk]);

  const add = async () => {
    if (talk?.step === "kept") {
      const body = text.trim();
      if (!body) return;
      try { await onAdd([{ kind: "paste", origin: `${TALK}${today()}`, body }]); } catch { return; }
      if (talk.me !== null) rememberMe(talk.me);
      forgetTalk();
      setText("");
      area.current?.focus();
      return;
    }
    if (ready.length === 0) return;
    // Whoever adds says what went wrong; the field keeps the text until it is in.
    try { await onAdd(ready.map((body) => ({ kind: "paste" as const, origin: null, body }))); } catch { return; }
    setText("");
    setMerged(false);
    setUnsure(false);
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
      <div className="box-top">
        <h3 className="box-head">{t("intake.box.paste")}</h3>
        <span className="src-hint">{t("paste.talkHint")}</span>
      </div>
      {talk?.step === "who" && pasted.current ? (
        <div className="who" role="group" aria-label={t("paste.talkWho")}>
          <p>{t("paste.talkWho")}</p>
          <div className="names">
            {[...pasted.current.reading.speakers, ...(pasted.current.reading.messages.some((m) => m.speaker === null) ? [null] : [])].map((name, i) => (
              <button key={name ?? ""} ref={i === 0 ? firstName : undefined} className="btn sm" onClick={() => keep(name)}>
                {name ?? t("paste.talkUnnamed")}
              </button>
            ))}
            <button className="link quiet-link" onClick={allMine}>{t("paste.talkAllMine")}</button>
          </div>
        </div>
      ) : (
        <textarea
          ref={area}
          className="paste-area"
          aria-label={t("intake.box.paste")}
          rows={5}
          value={text}
          placeholder={t("paste.placeholder")}
          disabled={busy}
          onPaste={onPaste}
          onChange={(e) => {
            setText(e.target.value);
            // Emptied by hand, or typed into after "nothing to add": whatever was pasted before is let go.
            if (!e.target.value.trim() || talk?.step === "none" || talk?.step === "allIn") forgetTalk();
            if (!e.target.value.trim()) setMerged(false);
          }}
        />
      )}
      {talk?.step === "kept" && (
        <p className="talk-line">
          <span role="status">{talkKept(talk.me, talk.partial)}</span>
          <button className="link" onClick={() => setTalk({ step: "who", was: talk.me })}>{t("paste.talkRechoose")}</button>
        </p>
      )}
      {(talk?.step === "none" || talk?.step === "allIn") && (
        <p className="talk-line"><span role="status">{t(talk.step === "none" ? "paste.talkNone" : "paste.talkAllIn")}</span></p>
      )}
      {unsure && !talk && text.trim() !== "" && (
        <p className="talk-line"><span role="status">{t("paste.talkUnsure")}</span></p>
      )}
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
        <button className="btn sm" disabled={busy || (kept ? !text.trim() : talk !== null || ready.length === 0)} onClick={() => void add()}>{t("paste.add")}</button>
        <span className="grow" />
        {talk?.step === "who" ? (
          <button className="link quiet-link" onClick={cancelTalk}>{t("paste.talkCancel")}</button>
        ) : (
          <>
            <button className="link quiet-link" disabled={busy} onClick={() => filePick.current?.click()}>{t("import.manualFile")}</button>
            <span className="src-hint">{t("paste.dropHint")}</span>
          </>
        )}
        <input ref={filePick} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" multiple hidden onChange={(e) => void onPick(e.target.files)} />
      </div>
    </section>
  );
}

/** "Keeping only {name}'s messages", the name in bold; its own sentence when the messages had no name. */
function talkKept(me: string | null, partial: boolean) {
  if (me === null) return t(partial ? "paste.talkKeptNewUnnamed" : "paste.talkKeptUnnamed");
  return t(partial ? "paste.talkKeptNew" : "paste.talkKept").split(/\{(\w+)\}/).map((piece, i) => (
    <Fragment key={i}>{i % 2 === 1 ? <b>{me}</b> : piece}</Fragment>
  ));
}
