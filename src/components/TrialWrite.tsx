import { useEffect, useState } from "react";
import { host, type Effort, type Platform, type Trial, type UiError, type Voice } from "../platform/host";
import { mockScene } from "../platform/mock";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { ErrorNote } from "./ErrorNote";

type Result = { trial: Trial; at: number; profileStamp: string };

// Try the voice on a brief without making an article. The previous result
// stays on screen, so a change to the profile can be judged side by side:
// the same brief, before and after.
export function TrialWrite({ voice }: { voice: Voice }) {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [platformId, setPlatformId] = useState("x");
  const [brief, setBrief] = useState(() => (mockScene()?.startsWith("voice-trial") ? "資本政策の相談で最初に聞くことについて。創業者向けに一言。" : ""));
  const [effort, setEffort] = useState<Effort>("fast");
  const [busy, setBusy] = useState(mockScene() === "voice-trial-generating");
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<UiError | null>(null);

  useEffect(() => { void host.platforms().then(setPlatforms).catch(() => {}); }, []);
  useEffect(() => {
    if (mockScene() === "voice-trial" || mockScene() === "voice-trial-compare") {
      void (async () => {
        const a = await host.trialWrite(voice.id, brief, "x", "fast");
        const list: Result[] = [{ trial: a, at: Date.now() - 120000, profileStamp: "" }];
        if (mockScene() === "voice-trial-compare") list.push({ trial: await host.trialWrite(voice.id, brief, "x", "fast"), at: Date.now(), profileStamp: "" });
        setResults(list);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stamp = JSON.stringify(voice.profile);
  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      const trial = await host.trialWrite(voice.id, brief, platformId, effort);
      setResults((r) => [...r.slice(-1), { trial, at: Date.now(), profileStamp: stamp }]);
    } catch (e) {
      const err = asUiError(e);
      if (err.code !== "cancelled") setError(err);
    } finally { setBusy(false); }
  };

  const [prev, latest] = results.length === 2 ? results : [null, results[0] ?? null];
  const changedSince = latest && latest.profileStamp && latest.profileStamp !== stamp;

  return (
    <section className="trial">
      <h3>{t("trial.title")}</h3>
      <p className="hint">{t("trial.lead")}</p>
      <div className="trial-form">
        <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t("write.briefPlaceholder")} rows={2} disabled={busy} aria-label={t("write.brief")} />
        <div className="row wrap">
          {platforms.length > 1 && (
            <select value={platformId} onChange={(e) => setPlatformId(e.target.value)} disabled={busy} aria-label={t("write.platform")}>
              {platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div className="seg" role="tablist">
            {(["fast", "quality"] as Effort[]).map((e) => (
              <button key={e} role="tab" aria-selected={effort === e} className={effort === e ? "on" : ""} onClick={() => setEffort(e)}>{t(e === "fast" ? "effort.fast" : "effort.quality")}</button>
            ))}
          </div>
          {busy ? (
            <span className="generating slim" role="status"><span className="spinner" aria-hidden="true" />{t("write.generating")} <button className="btn sm" onClick={() => void host.cancelGenerate()}>{t("write.cancel")}</button></span>
          ) : (
            <button className="btn pri sm" disabled={!brief.trim()} onClick={() => void run()}>{latest ? t("trial.again") : t("trial.write")}</button>
          )}
        </div>
        {changedSince && !busy && <p className="hint">{t("trial.changed")}</p>}
      </div>
      {error && <ErrorNote error={error} />}
      {latest && (
        <div className={prev ? "trial-results two" : "trial-results"}>
          {prev && (
            <div className="trial-card prev">
              <div className="trial-label">{t("trial.before")}</div>
              <p className="trial-text">{prev.trial.text}</p>
            </div>
          )}
          <div className="trial-card">
            <div className="trial-label">{prev ? t("trial.after") : t("trial.result")}</div>
            <p className="trial-text">{latest.trial.text}</p>
            {latest.trial.voice_notes && <p className="hint">{latest.trial.voice_notes}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
