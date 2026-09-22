import { useCallback, useEffect, useState } from "react";
import { host, type Draft, type Effort, type Platform, type UiError, type Voice } from "../platform/host";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { ErrorNote } from "./ErrorNote";

type Phase =
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "result"; draft: Draft; text: string; notes: string; copied: boolean };

const EFFORT_KEY = "lita.effort";

// Brief → draft → judge. The whole post arrives at once (D-23), so while
// waiting there is only an indicator and a way to stop.
export function WriteScreen({ voice, onBack }: { voice: Voice; onBack: () => void }) {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [platformId, setPlatformId] = useState("x");
  const [brief, setBrief] = useState("");
  const [effort, setEffort] = useState<Effort>(() => {
    try { return (localStorage.getItem(EFFORT_KEY) as Effort) || "quality"; } catch { return "quality"; }
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<UiError | null>(null);

  useEffect(() => { void host.platforms().then(setPlatforms).catch(() => {}); }, []);
  useEffect(() => { try { localStorage.setItem(EFFORT_KEY, effort); } catch {} }, [effort]);

  const platform = platforms.find((p) => p.id === platformId) ?? null;
  const canWrite = brief.trim().length > 0 && phase.kind !== "generating";

  // The preview is the real prompt from the native side (B-08), fetched
  // when opened so it always matches the current brief.
  useEffect(() => {
    if (!previewOpen) return;
    let live = true;
    setPreview(null);
    void host.previewPrompt(voice.id, brief, platformId).then((p) => { if (live) setPreview(p); }).catch(() => {});
    return () => { live = false; };
  }, [previewOpen, voice.id, brief, platformId]);

  const generate = useCallback(async () => {
    setError(null);
    setPhase({ kind: "generating" });
    try {
      const g = await host.generateDraft(voice.id, brief, platformId, effort);
      setPhase({ kind: "result", draft: g.draft, text: g.draft.body, notes: g.voice_notes, copied: false });
    } catch (e) {
      const err = asUiError(e);
      setPhase({ kind: "idle" });
      if (err.code !== "cancelled") setError(err);
    }
  }, [voice.id, brief, platformId, effort]);

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

  const count = phase.kind === "result" ? [...phase.text].length : 0;
  const over = platform?.max_chars != null && count > platform.max_chars ? count - platform.max_chars : 0;

  return (
    <div className="write">
      <button className="back" onClick={onBack}>← {t("write.back")}</button>
      <h2>{t("write.title", { name: voice.name })}</h2>
      <p className="sub">{t("write.briefHint")}</p>

      <label className="field">
        <span>{t("write.brief")}</span>
        <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t("write.briefPlaceholder")} rows={3} disabled={phase.kind === "generating"} />
      </label>

      <div className="write-options">
        <div className="opt">
          <span className="opt-label">{t("write.platform")}</span>
          <div className="seg" role="tablist">
            {platforms.map((p) => (
              <button key={p.id} role="tab" aria-selected={platformId === p.id} className={platformId === p.id ? "on" : ""} onClick={() => setPlatformId(p.id)}>
                {p.name}{p.max_chars != null && <span className="seg-sub"> {p.max_chars}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="opt">
          <span className="opt-label">{t("write.effort")}</span>
          <div className="seg" role="tablist">
            {(["fast", "quality"] as Effort[]).map((e) => (
              <button key={e} role="tab" aria-selected={effort === e} className={effort === e ? "on" : ""} title={t(e === "fast" ? "effort.fastHint" : "effort.qualityHint")} onClick={() => setEffort(e)}>
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

      {error && <ErrorNote error={error} />}

      {phase.kind !== "result" && (
        <div className="write-actions">
          {phase.kind === "generating" ? (
            <div className="generating" role="status">
              <span className="spinner" aria-hidden="true" />
              <div><div>{t("write.generating")}</div><div className="hint">{t("write.generatingHint")}</div></div>
              <button className="btn" onClick={() => void host.cancelGenerate()}>{t("write.cancel")}</button>
            </div>
          ) : (
            <button className="btn pri" disabled={!canWrite} onClick={() => void generate()}>{t("write.generate")}</button>
          )}
        </div>
      )}

      {phase.kind === "result" && (
        <section className="draft">
          <div className="draft-head">
            <h3>{t("write.result")}</h3>
            <span className={over ? "count over" : "count"}>
              {platform?.max_chars != null ? t("write.chars", { n: String(count), max: String(platform.max_chars) }) : t("write.charsNoMax", { n: String(count) })}
            </span>
          </div>
          <textarea className="draft-text" value={phase.text} onChange={(e) => setPhase({ ...phase, text: e.target.value, copied: false })} rows={6} aria-label={t("write.result")} />
          {over > 0 && <p className="warn small">{t("write.over", { n: String(over) })}</p>}
          <p className="hint">{t("write.editHint")}</p>
          {phase.notes && <p className="notes"><span className="muted">{t("write.notes")}:</span> {phase.notes}</p>}
          <div className="draft-actions">
            <button className="btn pri" onClick={() => void approve()}>{t("write.copy")}</button>
            <button className="btn" onClick={() => void generate()}>{t("write.again")}</button>
            <button className="quiet" onClick={() => void discard()}>{t("write.discard")}</button>
            {phase.copied && <span className="ok small" role="status">{t("write.copied")}</span>}
          </div>
        </section>
      )}
    </div>
  );
}
