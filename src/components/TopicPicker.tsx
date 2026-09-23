import { useEffect, useRef, useState } from "react";
import { host, type Effort, type Platform, type Policy, type UiError, type VoiceSummary } from "../platform/host";
import { mockScene } from "../platform/mock";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { ErrorNote } from "./ErrorNote";

// One screen, one job: decide what to write about. The editorial policy sits
// open (nothing to unfold), the direction is one line that may stay empty,
// and the ten titles are ten pressable lines. Picking some and pressing the
// one primary button lines up that many drafts and returns to the list.
const EFFORT_KEY = "lita.effort";
const MAX_PICKS = 5;

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
      const list = await host.suggestTopics(direction.trim());
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
      const effort = ((): Effort => { try { return (localStorage.getItem(EFFORT_KEY) as Effort) || "quality"; } catch { return "quality"; } })();
      // Lined up in the order they were offered, not the order they were ticked.
      const titles = (topics ?? []).filter((x) => picked.includes(x));
      await host.enqueueArticles(titles, voiceId, platformId, effort, direction.trim());
      onQueued(titles.length);
    } catch (e) { setError(asUiError(e)); setWorking(false); }
  };

  const noVoice = voices !== null && voices.length === 0;

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
          <div className="sect">
            <div className="sect-head">
              <h4>{t("policy.title")}</h4>
              <span className="muted">{t("topics.optional")}</span>
              <button className="link" onClick={() => void draft()} disabled={drafting}>{t("policy.draft")}</button>
            </div>
            <div className="policy">
              <PolicyRow label={t("policy.audience")} value={policy.audience} placeholder={t("policy.audiencePlaceholder")} onChange={(v) => editPolicy({ audience: v })} onBlur={savePolicy} />
              <PolicyRow label={t("policy.takeaway")} value={policy.takeaway} placeholder={t("policy.takeawayPlaceholder")} onChange={(v) => editPolicy({ takeaway: v })} onBlur={savePolicy} />
              <PolicyRow
                label={t("policy.topics")} value={policy.topics.join("、")} placeholder={t("policy.topicsPlaceholder")}
                onChange={(v) => editPolicy({ topics: v.split(/[、,]/).map((s) => s.trim()).filter(Boolean).slice(0, 3) })}
                onBlur={savePolicy}
              />
              <PolicyRow label={t("policy.avoid")} value={policy.avoid} placeholder={t("policy.avoidPlaceholder")} onChange={(v) => editPolicy({ avoid: v })} onBlur={savePolicy} />
            </div>
            {drafting && <p className="working" role="status"><span className="spinner" aria-hidden="true" />{t("policy.drafting")}</p>}
          </div>

          <div className="sect">
            <div className="sect-head"><h4>{t("topics.direction")}</h4></div>
            <div className="aim">
              <input value={direction} onChange={(e) => setDirection(e.target.value)} placeholder={t("topics.directionPlaceholder")} aria-label={t("topics.direction")} />
              {topics && <button className="link" onClick={() => void suggest()} disabled={working}>{t("topics.again")}</button>}
            </div>
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

function PolicyRow({ label, value, placeholder, onChange, onBlur }: { label: string; value: string; placeholder: string; onChange: (v: string) => void; onBlur: () => void }) {
  return (
    <label className="pf">
      <span>{label}</span>
      <input className="v" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </label>
  );
}
