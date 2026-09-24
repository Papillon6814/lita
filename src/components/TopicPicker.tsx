import { useEffect, useRef, useState } from "react";
import { host, type Platform, type Policy, type TopicCloud, type UiError, type VoiceSummary } from "../platform/host";
import { mockScene } from "../platform/mock";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { ErrorNote } from "./ErrorNote";

// One screen, one job: decide what to write about. The words someone keeps
// writing sit at the top, pressable; the direction is one line that may stay
// empty; the editorial policy sits open below (nothing to unfold); and the
// ten titles are ten pressable lines. Picking some and pressing the one
// primary button lines up that many drafts and returns to the list.
const MAX_PICKS = 5;
/** Words that can be pressed at once. More than three and the titles scatter. */
const MAX_WORDS = 3;
/** Fewer than five words is not a cloud; one line stands in for it. */
const MIN_WORDS = 5;

/** 1–5 folded into the three sizes on screen. The number itself is never shown. */
const size = (weight: number) => (weight >= 4 ? 3 : weight === 3 ? 2 : 1);

const emptyPolicy: Policy = { audience: "", takeaway: "", topics: [], avoid: "" };

type Props = { onBack: () => void; onQueued: (n: number) => void; onGoVoices: () => void };

export function TopicPicker({ onBack, onQueued, onGoVoices }: Props) {
  const [policy, setPolicy] = useState<Policy>(emptyPolicy);
  const [drafting, setDrafting] = useState(false);
  const [direction, setDirection] = useState("");
  const [topics, setTopics] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [voices, setVoices] = useState<VoiceSummary[] | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [platformId, setPlatformId] = useState("");
  const [cloud, setCloud] = useState<TopicCloud | null>(null);
  const [materialCount, setMaterialCount] = useState(0);
  const [gathering, setGathering] = useState(false);
  const [cloudFailed, setCloudFailed] = useState(false);
  const [subjects, setSubjects] = useState<string[]>([]);
  // Which gather is the current one. Stopping bumps it, so a reply that
  // arrives afterwards is ignored and the previous words stay.
  const gatherRun = useRef(0);
  const policyRef = useRef(policy);
  policyRef.current = policy;

  useEffect(() => {
    void host.getPolicy().then(setPolicy).catch(() => {});
    void host.platforms().then(setPlatforms).catch(() => {});
    void host.listVoices().then(async (vs) => {
      setVoices(vs);
      // The voice and destination of the last article, as a new article has (D-55).
      let v = vs.length === 1 ? vs[0].id : "";
      let p = "";
      try {
        const recent = await host.listArticles();
        v = recent.find((a) => a.voice_id)?.voice_id ?? v;
        p = recent[0]?.platform_id ?? "";
      } catch {}
      setVoiceId(v);
      setPlatformId(p);
    }).catch(() => {});
  }, []);
  // A queued article is 1,500–3,000 characters (requirement 11), so the
  // destination is a long-form one: the last article's if it has no limit,
  // otherwise the first destination without one.
  useEffect(() => {
    if (platforms.length === 0) return;
    const chosen = platforms.find((p) => p.id === platformId);
    if (chosen && chosen.max_chars == null) return;
    const longForm = platforms.find((p) => p.max_chars == null) ?? platforms[0];
    setPlatformId(longForm.id);
  }, [platforms, platformId]);

  // The cloud as it was last gathered. With material but no cloud yet, it is
  // gathered once on opening (requirement 7a); never again on its own.
  useEffect(() => {
    void host.getTopicCloud().then((v) => {
      setCloud(v.cloud);
      setMaterialCount(v.material_count);
      if (v.cloud) setSubjects(scenePicks(v.cloud));
      if (!v.cloud && v.material_count > 0) void gather(false);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ten to twenty seconds, with nothing to report in between (D-23). The
  // previous words stay on screen throughout, and the primary button keeps
  // working: titles can be offered without a cloud.
  const gather = async (manual: boolean) => {
    const run = ++gatherRun.current;
    setCloudFailed(false);
    setGathering(true);
    try {
      const v = await host.gatherTopicCloud();
      if (run !== gatherRun.current) return;
      setCloud(v.cloud);
      setMaterialCount(v.material_count);
      // The words themselves changed, so what was pressed no longer holds.
      if (manual) setSubjects([]);
    } catch {
      if (run !== gatherRun.current) return;
      setCloudFailed(true);
    } finally {
      if (run === gatherRun.current) setGathering(false);
    }
  };

  const stopGather = () => {
    gatherRun.current += 1;
    setGathering(false);
    void host.cancelGenerate().catch(() => {});
  };

  const toggleWord = (word: string) =>
    setSubjects((s) => (s.includes(word) ? s.filter((x) => x !== word) : s.length >= MAX_WORDS ? s : [...s, word]));

  const savePolicy = () => { void host.setPolicy(policyRef.current).catch(() => {}); };
  const editPolicy = (patch: Partial<Policy>) => setPolicy((p) => ({ ...p, ...patch }));

  const draft = async () => {
    setError(null);
    setDrafting(true);
    try {
      const p = await host.draftPolicy();
      setPolicy(p);
      policyRef.current = p;
      await host.setPolicy(p);
    } catch (e) { setError(asUiError(e)); } finally { setDrafting(false); }
  };

  const suggest = async () => {
    setError(null);
    setWorking(true);
    setTopics(null);
    setPicked([]);
    try {
      const list = await host.suggestTopics(subjects, direction.trim());
      setTopics(list);
      return list;
    } catch (e) { setError(asUiError(e)); return null; } finally { setWorking(false); }
  };

  // The mock's "three picked" scene starts where a person would be after
  // pressing once and choosing three.
  const once = useRef(false);
  useEffect(() => {
    if (once.current || mockScene() !== "topics-picked") return;
    once.current = true;
    void suggest().then((list) => { if (list) setPicked([list[0], list[2], list[7]].filter(Boolean)); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (title: string) => setPicked((p) => (p.includes(title) ? p.filter((x) => x !== title) : p.length >= MAX_PICKS ? p : [...p, title]));

  const stack = async () => {
    setError(null);
    setWorking(true);
    try {
      await host.setPolicy(policyRef.current);
      // Lined up in the order they were offered, not the order they were ticked.
      const titles = (topics ?? []).filter((x) => picked.includes(x));
      await host.enqueueArticles(titles, voiceId, platformId, "quality", subjects, direction.trim());
      onQueued(titles.length);
    } catch (e) { setError(asUiError(e)); setWorking(false); }
  };

  const noVoice = voices !== null && voices.length === 0;
  const words = cloud?.words ?? [];
  const hasWords = words.length >= MIN_WORDS;
  const capped = subjects.length >= MAX_WORDS;
  const moreSince = cloud !== null && materialCount > cloud.material_count;
  // A line in the cloud's place takes over from the "gather again" link.
  const quietLine = gathering || cloudFailed || moreSince;
  // No material at all, or too few words: the cloud is not there to be seen.
  const showCloud = materialCount > 0 && (hasWords || gathering || cloudFailed);
  const fewWords = materialCount > 0 && cloud !== null && !hasWords && !gathering && !cloudFailed;

  return (
    <div className="topics-page">
      <button className="back" onClick={onBack}>← {t("article.filter.all")}</button>
      <h2>{t("topics.title")}</h2>
      {/* What this screen is for, until the titles themselves say it. */}
      {!noVoice && !topics && <p className="lead-sm sub">{t("topics.lead")}</p>}

      {noVoice ? (
        <div className="empty">
          <p className="lead-sm">{t("topics.needVoice")}</p>
          <button className="btn pri" onClick={onGoVoices}>{t("article.goVoices")}</button>
        </div>
      ) : (
        <>
          {showCloud && (
            <div className="cloud-box">
              <div className="cloud-head">
                <h4>{t("cloud.title")}</h4>
                {hasWords && subjects.length === 0 && !quietLine && <span className="muted">{t("cloud.hint")}</span>}
                <span className="grow" />
                {!quietLine && <button className="link" onClick={() => void gather(true)}>{t("cloud.again")}</button>}
              </div>
              {gathering && (
                <p className="cloud-note" role="status">
                  <span className="spinner" aria-hidden="true" />{t("cloud.gathering")}
                  <button className="link" onClick={stopGather}>{t("cloud.cancel")}</button>
                </p>
              )}
              {!gathering && cloudFailed && (
                <p className="cloud-note" role="status">
                  {t("cloud.failed")}
                  <button className="link" onClick={() => void gather(true)}>{t("cloud.again")}</button>
                </p>
              )}
              {!gathering && !cloudFailed && moreSince && (
                <p className="cloud-note">
                  {t("cloud.more")}
                  <button className="link" onClick={() => void gather(true)}>{t("cloud.again")}</button>
                </p>
              )}
              {hasWords && (
                <>
                  <div className={capped ? "cloud capped" : "cloud"}>
                    {words.map((w) => {
                      const on = subjects.includes(w.word);
                      return (
                        <button
                          key={w.word} type="button" aria-pressed={on} disabled={!on && capped}
                          className={`w s${size(w.weight)}${w.written ? " done" : ""}`}
                          onClick={() => toggleWord(w.word)}
                        >{w.word}</button>
                      );
                    })}
                  </div>
                  <p className="cloud-foot">{capped ? t("cloud.limit") : t("cloud.legend")}</p>
                </>
              )}
            </div>
          )}
          {/* Too few words to make a cloud: one line, and the screen is otherwise unchanged. */}
          {fewWords && <p className="cloud-note lone">{t("cloud.few")}</p>}

          <div className="sect">
            <div className="sect-head"><h4>{t("topics.direction")}</h4></div>
            <div className="aim">
              <div className="seedfield">
                {subjects.map((w) => (
                  <button key={w} type="button" className="seed" onClick={() => toggleWord(w)} aria-label={t("cloud.drop", { word: w })}>
                    {w}<span className="x" aria-hidden="true">×</span>
                  </button>
                ))}
                <input
                  value={direction} onChange={(e) => setDirection(e.target.value)}
                  placeholder={subjects.length > 0 ? t("cloud.addWord") : t("topics.directionPlaceholder")}
                  aria-label={t("topics.direction")}
                />
              </div>
              {topics && <button className="link" onClick={() => void suggest()} disabled={working}>{t("topics.again")}</button>}
            </div>
          </div>

          <div className="sect">
            <div className="sect-head">
              <h4>{t("policy.title")}</h4>
              <span className="muted">{t("topics.optional")}</span>
              <button className="link" onClick={() => void draft()} disabled={drafting}>{t("policy.draft")}</button>
            </div>
            <div className="policy">
              <PolicyRow label={t("policy.audience")} value={policy.audience} placeholder={t("policy.audiencePlaceholder")} onChange={(v) => editPolicy({ audience: v })} onBlur={savePolicy} />
              <PolicyRow label={t("policy.takeaway")} value={policy.takeaway} placeholder={t("policy.takeawayPlaceholder")} onChange={(v) => editPolicy({ takeaway: v })} onBlur={savePolicy} />
              <PolicyRow label={t("policy.avoid")} value={policy.avoid} placeholder={t("policy.avoidPlaceholder")} onChange={(v) => editPolicy({ avoid: v })} onBlur={savePolicy} />
            </div>
            {drafting && <p className="working" role="status"><span className="spinner" aria-hidden="true" />{t("policy.drafting")}</p>}
          </div>

          {working && !topics && <p className="working" role="status"><span className="spinner" aria-hidden="true" />{t("topics.working")}</p>}

          {topics && (
            <div className="sect">
              <ul className="topics" role="status">
                {topics.map((title) => {
                  const on = picked.includes(title);
                  return (
                    <li key={title}>
                      <label className={on ? "trow on" : "trow"}>
                        <input type="checkbox" checked={on} disabled={!on && picked.length >= MAX_PICKS} onChange={() => toggle(title)} />
                        <span className="t">{title}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {error && <ErrorNote error={error} />}

          {topics ? (
            <div className="stack">
              <span className="sel">{t("assist.voice")}
                <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} aria-label={t("assist.voice")}>
                  {(voices ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </span>
              <span className="sel">{t("write.platform")}
                <select value={platformId} onChange={(e) => setPlatformId(e.target.value)} aria-label={t("write.platform")}>
                  {platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </span>
              <span className="small muted">{picked.length >= MAX_PICKS ? t("topics.limit") : t("topics.sameAsLast")}</span>
              <span className="grow" />
              <button className="btn pri" disabled={picked.length === 0 || working} onClick={() => void stack()}>
                {picked.length === 0 ? t("topics.stackEmpty") : t("topics.stack", { n: String(picked.length) })}
              </button>
            </div>
          ) : (
            <div className="stack">
              <span className="grow" />
              <button className="btn pri" disabled={working} onClick={() => void suggest()}>{t("topics.suggest")}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// The mock's "three words pressed" scene starts where a person would be
// after pressing three words. Nothing here runs in a real build.
function scenePicks(cloud: TopicCloud): string[] {
  if (mockScene() !== "topics-cloud-picked") return [];
  const wanted = ["採用", "定着", "評価"].filter((w) => cloud.words.some((x) => x.word === w));
  return (wanted.length === MAX_WORDS ? wanted : cloud.words.slice(0, MAX_WORDS).map((w) => w.word));
}

function PolicyRow({ label, value, placeholder, onChange, onBlur }: { label: string; value: string; placeholder: string; onChange: (v: string) => void; onBlur: () => void }) {
  return (
    <label className="pf">
      <span>{label}</span>
      <input className="v" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </label>
  );
}
