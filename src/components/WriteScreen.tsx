import { useCallback, useEffect, useRef, useState } from "react";
import { host, type Draft, type Effort, type Platform, type UiError, type Voice } from "../platform/host";
import { mockScene } from "../platform/mock";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { ErrorNote } from "./ErrorNote";

type Phase =
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "result"; draft: Draft; text: string; notes: string; copied: boolean };

const EFFORT_KEY = "lita.effort";
// The brief survives a trip back to the Voice screen (#41), per voice, for
// this session only.
const briefKey = (voiceId: string) => `lita.brief.${voiceId}`;

// Brief → draft → judge. The whole post arrives at once (D-23), so while
// waiting there is only an indicator and a way to stop. Once a draft is
// here it takes the top of the screen and the brief folds into one line,
// so the thing to judge is never below the fold (UX re-review, 2026-09-22).
export function WriteScreen({ voice, onBack }: { voice: Voice; onBack: () => void }) {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [platformId, setPlatformId] = useState("x");
  const [brief, setBrief] = useState(() => {
    if (mockScene()?.startsWith("write-")) return "資本政策の相談を受けたときに最初に聞くことについて。創業者に向けて、エクイティは時間を売る契約だと伝えたい。";
    try { return sessionStorage.getItem(briefKey(voice.id)) ?? ""; } catch { return ""; }
  });
  const [effort, setEffort] = useState<Effort>(() => {
    try { return (localStorage.getItem(EFFORT_KEY) as Effort) || "quality"; } catch { return "quality"; }
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [editingBrief, setEditingBrief] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const draftHead = useRef<HTMLHeadingElement>(null);

  useEffect(() => { void host.platforms().then(setPlatforms).catch(() => {}); }, []);
  useEffect(() => { try { localStorage.setItem(EFFORT_KEY, effort); } catch {} }, [effort]);
  useEffect(() => { try { sessionStorage.setItem(briefKey(voice.id), brief); } catch {} }, [voice.id, brief]);

  const platform = platforms.find((p) => p.id === platformId) ?? null;
  const canWrite = brief.trim().length > 0 && phase.kind !== "generating";
  const showForm = phase.kind !== "result" || editingBrief;

  // The preview is the real prompt from the native side (B-08), fetched
  // when opened so it always matches the current brief.
  useEffect(() => {
    if (!previewOpen) return;
    let live = true;
    setPreview(null);
    void host.previewPrompt(voice.id, brief, platformId).then((p) => { if (live) setPreview(p); }).catch(() => {});
    return () => { live = false; };
  }, [previewOpen, voice.id, brief, platformId]);

  // `previous` asks for a shorter rewrite of that draft instead of a fresh one (#40).
  const generate = useCallback(async (previous?: string) => {
    if (!brief.trim()) return;
    setError(null);
    setEditingBrief(false);
    setPhase({ kind: "generating" });
    try {
      const g = await host.generateDraft(voice.id, brief, platformId, effort, previous);
      setPhase({ kind: "result", draft: g.draft, text: g.draft.body, notes: g.voice_notes, copied: mockScene() === "write-copied" });
    } catch (e) {
      const err = asUiError(e);
      setPhase({ kind: "idle" });
      if (err.code !== "cancelled") setError(err);
    }
  }, [voice.id, brief, platformId, effort]);

  // Mock scenes that start mid-flow (screenshots): kick off one generation.
  useEffect(() => { if (mockScene()?.startsWith("write-")) void generate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // A finished draft is announced by moving focus to its heading.
  useEffect(() => { if (phase.kind === "result") draftHead.current?.focus(); }, [phase.kind]);

  const approve = useCallback(async () => {
    if (phase.kind !== "result") return;
    try {
      await host.copyText(phase.text);
      await host.setDraftStatus(phase.draft.id, "approved");
      setPhase({ ...phase, copied: true });
    } catch (e) {
      setError(asUiError(e));
    }
  }, [phase]);

  const discard = useCallback(async () => {
    if (phase.kind !== "result") return;
    try { await host.setDraftStatus(phase.draft.id, "discarded"); } catch { /* the draft is already off screen */ }
    setPhase({ kind: "idle" });
  }, [phase]);

  // Leaving while Codex is writing would leave it running for nothing.
  const back = () => { if (phase.kind === "generating") void host.cancelGenerate(); onBack(); };
  const onKey = (e: React.KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canWrite) { e.preventDefault(); void generate(); } };
  const shorten = () => { if (phase.kind === "result") void generate(phase.text); };

  const count = phase.kind === "result" ? [...phase.text].length : 0;
  const over = platform?.max_chars != null && count > platform.max_chars ? count - platform.max_chars : 0;

  const draftSection = phase.kind === "result" && (
    <section className="draft" aria-live="polite">
      <div className="draft-head">
        <h3 ref={draftHead} tabIndex={-1}>{t("write.result")}</h3>
        <span className={over ? "count over" : "count"}>
          {platform?.max_chars != null ? t("write.chars", { n: String(count), max: String(platform.max_chars) }) : t("write.charsNoMax", { n: String(count) })}
        </span>
      </div>
      <textarea className="draft-text" value={phase.text} onChange={(e) => setPhase({ ...phase, text: e.target.value, copied: false })} rows={5} aria-label={t("write.result")} />
      {over > 0 && (
        <p className="warn small over-line">
          {t("write.over", { n: String(over) })}{" "}
          <button className="btn sm" onClick={shorten}>{t("write.shorten")}</button>
        </p>
      )}
      {!phase.copied && <p className="hint">{t("write.editHint")}</p>}
      {phase.notes && <p className="notes"><span className="muted">{t("write.notes")}:</span> {phase.notes}</p>}
      <div className="draft-actions">
        {phase.copied ? (
          <span className="ok" role="status">✓ {t("write.copied")}</span>
        ) : (
          <button className="btn pri" onClick={() => void approve()}>{t("write.copy")}</button>
        )}
        <button className="btn" onClick={() => void generate()}>{t("write.again")}</button>
        {!phase.copied && <button className="quiet" onClick={() => void discard()}>{t("write.discard")}</button>}
      </div>
    </section>
  );

  return (
    <div className="write" onKeyDown={onKey}>
      <button className="back" onClick={back}>← {t("write.back")}</button>
      <h2>{t("write.title", { name: voice.name })}</h2>
      {phase.kind !== "result" && <p className="sub">{t("write.briefHint")}</p>}

      {draftSection}

      {!showForm && phase.kind === "result" && (
        <p className="brief-line">
          <span className="muted">{t("write.brief")}: </span>{brief}{" "}
          <button className="link" onClick={() => setEditingBrief(true)}>{t("write.editBrief")}</button>
        </p>
      )}

      {showForm && (
        <>
          <label className="field">
            <span>{t("write.brief")}</span>
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t("write.briefPlaceholder")} rows={3} disabled={phase.kind === "generating"} autoFocus={editingBrief} />
          </label>

          <div className="write-options">
            {platforms.length > 1 ? (
              <div className="opt">
                <span className="opt-label">{t("write.platform")}</span>
                <div className="seg" role="tablist">
                  {platforms.map((p) => (
                    <button key={p.id} role="tab" aria-selected={platformId === p.id} className={platformId === p.id ? "on" : ""} onClick={() => setPlatformId(p.id)}>{p.name}</button>
                  ))}
                </div>
              </div>
            ) : platform && (
              <div className="opt">
                <span className="opt-label">{t("write.platform")}</span>
                <span className="opt-static">{platform.max_chars != null ? t("write.platformStatic", { name: platform.name, max: String(platform.max_chars) }) : platform.name}</span>
              </div>
            )}
            <div className="opt">
              <span className="opt-label">{t("write.effort")}</span>
              <div className="seg" role="tablist">
                {(["fast", "quality"] as Effort[]).map((e) => (
                  <button key={e} role="tab" aria-selected={effort === e} className={effort === e ? "on" : ""} onClick={() => setEffort(e)}>
                    {t(e === "fast" ? "effort.fast" : "effort.quality")}
                  </button>
                ))}
              </div>
              <span className="hint inline">{t(effort === "fast" ? "effort.fastHint" : "effort.qualityHint")}</span>
            </div>
          </div>

          <details className="more" open={previewOpen} onToggle={(e) => setPreviewOpen((e.target as HTMLDetailsElement).open)}>
            <summary>{t("write.preview")}</summary>
            <pre className="prompt">{preview ?? "…"}</pre>
          </details>
        </>
      )}

      {error && <ErrorNote error={error} />}

      {showForm && (
        <div className="write-actions">
          {phase.kind === "generating" ? (
            <div className="generating" role="status">
              <span className="spinner" aria-hidden="true" />
              <div><div>{t("write.generating")}</div><div className="hint">{t("write.generatingHint")}</div></div>
              <button className="btn" onClick={() => void host.cancelGenerate()}>{t("write.cancel")}</button>
            </div>
          ) : (
            <div className="row">
              <button className="btn pri" disabled={!canWrite} onClick={() => void generate()}>{phase.kind === "result" ? t("write.again") : t("write.generate")}</button>
              <span className="hint inline muted">{t("write.shortcut")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
