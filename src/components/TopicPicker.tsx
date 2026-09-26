import { Fragment, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { host, type Platform, type Policy, type TopicCloud, type UiError, type VoiceSummary } from "../platform/host";
import { mockScene } from "../platform/mock";
import { asUiError } from "../errors";
import { t } from "../i18n";
import type { MessageKey } from "../i18n/en";
import { ErrorNote } from "./ErrorNote";

// One screen, one job: decide what to write about (D-71). There is nothing to
// type: the words someone keeps writing sit in a cloud and may be pressed, or
// not, and one primary button offers ten titles. The editorial policy is the
// quiet link "編集方針" at the end of the title row; it opens in place and is
// closed again every time the screen opens. The ten titles are ten pressable
// lines, and picking some lines up that many drafts.
const MAX_PICKS = 5;
/** Words that can be pressed at once. More than three and the titles scatter. */
const MAX_WORDS = 3;
/** Fewer than three words is not a cloud: there is nothing to choose between (#129). */
const MIN_WORDS = 3;

/** 1–5 folded into the three sizes on screen. The number itself is never shown. */
const size = (weight: number) => (weight >= 4 ? 3 : weight === 3 ? 2 : 1);

const emptyPolicy: Policy = { audience: "", takeaway: "", topics: [], avoid: "" };

type Props = { onBack: () => void; onQueued: (n: number) => void; onGoVoices: () => void };

export function TopicPicker({ onBack, onQueued, onGoVoices }: Props) {
  const [policy, setPolicy] = useState<Policy>(emptyPolicy);
  const [drafting, setDrafting] = useState(false);
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
  // The words the titles on screen were offered from. Words pressed after
  // that only count once the titles are offered again.
  const [offeredWith, setOfferedWith] = useState<string[]>([]);
  // The policy starts closed every time (D-71); whether it was open is not kept.
  const [policyOpen, setPolicyOpen] = useState(() => mockScene()?.startsWith("topics-policy-open") ?? false);
  // Whether all three lines were empty when it was opened: the one sentence
  // about what the policy is for stays put while someone types.
  const [policyBlank, setPolicyBlank] = useState(false);
  const [changing, setChanging] = useState(false);
  const policyLink = useRef<HTMLButtonElement>(null);
  const policyFirst = useRef<HTMLInputElement>(null);
  const policySection = useRef<HTMLElement>(null);
  const voiceSelect = useRef<HTMLSelectElement>(null);
  // Which gather is the current one. Stopping bumps it, so a reply that
  // arrives afterwards is ignored and the previous words stay.
  const gatherRun = useRef(0);
  const once = useRef(false);
  const policyRef = useRef(policy);
  policyRef.current = policy;

  useEffect(() => {
    void host.getPolicy().then((p) => { setPolicy(p); setPolicyBlank(isBlank(p)); }).catch(() => {});
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

  // The cloud as it was last gathered. With writing but no cloud yet, it is
  // gathered once on opening (requirement 7a). A cloud too thin to show is
  // gathered again once when the writing changed since (#129): nothing on
  // screen would offer to. Clouds counted before #129 also counted articles,
  // so "changed", not "more": they are gathered once and counted afresh.
  // A cloud that shows is never gathered again on its own.
  useEffect(() => {
    void host.getTopicCloud().then((v) => {
      setCloud(v.cloud);
      setMaterialCount(v.material_count);
      const picks = v.cloud ? scenePicks(v.cloud) : [];
      if (v.cloud) setSubjects(picks);
      const thin = v.cloud !== null && v.cloud.words.length < MIN_WORDS && v.material_count !== v.cloud.material_count;
      if (v.material_count > 0 && (!v.cloud || thin)) void gather(false);
      // The mock's "three picked" scenes start where a person would be after
      // pressing the words, offering once, and choosing three.
      if (isPickedScene() && !once.current) {
        once.current = true;
        void suggest(picks).then((list) => { if (list) setPicked([list[0], list[2], list[7]].filter(Boolean)); });
      }
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
  const openPolicy = () => {
    setPolicyBlank(isBlank(policyRef.current));
    setPolicyOpen(true);
    // The link goes away as the lines open; the first line takes the keyboard.
    requestAnimationFrame(() => policyFirst.current?.focus());
  };
  const closePolicy = () => {
    setPolicyOpen(false);
    requestAnimationFrame(() => policyLink.current?.focus());
  };

  const draft = async () => {
    setError(null);
    setDrafting(true);
    try {
      const p = await host.draftPolicy();
      setPolicy(p);
      policyRef.current = p;
      setPolicyBlank(false);
      await host.setPolicy(p);
    } catch (e) { setError(asUiError(e)); } finally { setDrafting(false); }
  };

  const suggest = async (words: string[] = subjects) => {
    setError(null);
    setWorking(true);
    setTopics(null);
    setPicked([]);
    try {
      // The Rust command keeps its "direction" argument; nothing is typed any
      // more, so it goes empty (D-71). Briefs already queued keep theirs.
      const list = await host.suggestTopics(words, "");
      setTopics(list);
      setOfferedWith(words);
      // The titles take the room the open policy was using. Closing it removes
      // the focused line without a blur, so what was typed is saved here, and
      // the keyboard goes back to the link that reopens it.
      const section = policySection.current;
      if (section) {
        const hadFocus = section.contains(document.activeElement);
        savePolicy();
        setPolicyOpen(false);
        if (hadFocus) requestAnimationFrame(() => policyLink.current?.focus());
      }
      return list;
    } catch (e) { setError(asUiError(e)); return null; } finally { setWorking(false); }
  };

  const toggle = (title: string) => setPicked((p) => (p.includes(title) ? p.filter((x) => x !== title) : p.length >= MAX_PICKS ? p : [...p, title]));

  const stack = async () => {
    setError(null);
    setWorking(true);
    try {
      await host.setPolicy(policyRef.current);
      // Lined up in the order they were offered, not the order they were ticked.
      const titles = (topics ?? []).filter((x) => picked.includes(x));
      await host.enqueueArticles(titles, voiceId, platformId, "quality", offeredWith, "");
      onQueued(titles.length);
    } catch (e) { setError(asUiError(e)); setWorking(false); }
  };

  const noVoice = voices !== null && voices.length === 0;
  const words = cloud?.words ?? [];
  const hasWords = words.length >= MIN_WORDS;
  const capped = subjects.length >= MAX_WORDS;
  const moreSince = cloud !== null && materialCount > cloud.material_count;
  // A line in the cloud's place takes over from the "gather again" link.
  const quietLine = gathering || cloudFailed || (moreSince && !topics);
  // No material at all, or too few words: the cloud is not there to be seen,
  // and no sentence promises it either (D-71). The room below stays empty.
  const showCloud = materialCount > 0 && (hasWords || gathering || cloudFailed);
  const voiceName = voices?.find((v) => v.id === voiceId)?.name;
  const platformName = platforms.find((p) => p.id === platformId)?.name;
  // One sentence says where the drafts will go; the two choices come out on "change".
  const showChoices = changing || !voiceName || !platformName;
  const again = <button className="link" onClick={() => void suggest()} disabled={working}>{t("topics.again")}</button>;

  return (
    <div className="topics-page">
      <button className="back" onClick={onBack}>← {t("article.filter.all")}</button>
      <div className="topics-head">
        <h2>{t("topics.title")}</h2>
        <span className="grow" />
        {!noVoice && !policyOpen && (
          <button
            ref={policyLink} type="button"
            className={isBlank(policy) ? "link quiet-link" : "link"}
            onClick={openPolicy}
          >{t("policy.title")}</button>
        )}
      </div>

      {!noVoice && policyOpen && (
        <section ref={policySection} className="policy-open" aria-label={t("policy.title")}>
          <div className="sect-head">
            <h4>{t("policy.title")}</h4>
            <span className="grow" />
            <button className="link" onClick={() => void draft()} disabled={drafting}>{t("policy.draft")}</button>
            <button className="link quiet-link" onClick={closePolicy}>{t("action.close")}</button>
          </div>
          {policyBlank && <p className="policy-why">{t("policy.why")}</p>}
          <div className="policy">
            <PolicyRow inputRef={policyFirst} label={t("policy.audience")} value={policy.audience} placeholder={t("policy.audiencePlaceholder")} onChange={(v) => editPolicy({ audience: v })} onBlur={savePolicy} />
            <PolicyRow label={t("policy.takeaway")} value={policy.takeaway} placeholder={t("policy.takeawayPlaceholder")} onChange={(v) => editPolicy({ takeaway: v })} onBlur={savePolicy} />
            <PolicyRow label={t("policy.avoid")} value={policy.avoid} placeholder={t("policy.avoidPlaceholder")} onChange={(v) => editPolicy({ avoid: v })} onBlur={savePolicy} />
          </div>
          {drafting && <p className="working" role="status"><span className="spinner" aria-hidden="true" />{t("policy.drafting")}</p>}
        </section>
      )}

      {/* What this screen is for, until the titles themselves say it. The only
          place that says nothing needs pressing (D-71). */}
      {!noVoice && !topics && <p className="lead-sm sub">{hasWords ? t("topics.leadCloud") : t("topics.lead")}</p>}

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
                <span className="grow" />
                {/* Before titles: gather the words again. After: offer the titles again,
                    keeping the pressed words (gathering would swap them out). */}
                {topics ? again : !quietLine && <button className="link" onClick={() => void gather(true)}>{t("cloud.again")}</button>}
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
              {!gathering && !cloudFailed && moreSince && !topics && (
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
                          aria-describedby={w.written ? "cloud-written" : undefined}
                          onClick={() => toggleWord(w.word)}
                        >{w.word}{w.written && <span className="tip" aria-hidden="true">{t("cloud.written")}</span>}</button>
                      );
                    })}
                  </div>
                  {/* What a faded word means, said only on pointing or focusing it. */}
                  <span id="cloud-written" className="sr-only">{t("cloud.written")}</span>
                  {capped && <p className="cloud-foot">{t("cloud.limit")}</p>}
                </>
              )}
            </div>
          )}

          {working && !topics && <p className="working" role="status"><span className="spinner" aria-hidden="true" />{t("topics.working")}</p>}

          {topics && (
            <div className="sect">
              {/* Without a cloud, "offer again" has no heading to sit beside. */}
              {!showCloud && <div className="sect-head"><span className="grow" />{again}</div>}
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
              {showChoices ? (
                <>
                  <span className="sel">{t("assist.voice")}
                    <select ref={voiceSelect} value={voiceId} onChange={(e) => setVoiceId(e.target.value)} aria-label={t("assist.voice")}>
                      {(voices ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </span>
                  <span className="sel">{t("write.platform")}
                    <select value={platformId} onChange={(e) => setPlatformId(e.target.value)} aria-label={t("write.platform")}>
                      {platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </span>
                </>
              ) : (
                <span className="says">
                  {rich("topics.writesIn", { voice: <b>{voiceName}</b>, platform: <b>{platformName}</b> })}
                  <button className="link" onClick={() => { setChanging(true); requestAnimationFrame(() => voiceSelect.current?.focus()); }}>{t("topics.change")}</button>
                </span>
              )}
              {picked.length >= MAX_PICKS && <span className="small muted">{t("topics.limit")}</span>}
              <span className="grow" />
              <button className="btn pri" disabled={picked.length === 0 || working} onClick={() => void stack()}>
                {picked.length === 0 ? t("topics.stackEmpty") : t("topics.stack", { n: String(picked.length) })}
              </button>
            </div>
          ) : (
            <div className={showCloud ? "stack" : "stack alone"}>
              {showCloud && <span className="grow" />}
              <button className="btn pri" disabled={working} onClick={() => void suggest()}>{t("topics.suggest")}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const isPickedScene = () => mockScene() === "topics-picked" || mockScene() === "topics-picked-few";

const isBlank = (p: Policy) => !p.audience.trim() && !p.takeaway.trim() && !p.avoid.trim();

/** A sentence with some of its words set in bold, in whichever order the locale puts them. */
function rich(key: MessageKey, parts: Record<string, ReactNode>): ReactNode {
  return t(key).split(/\{(\w+)\}/).map((piece, i) => <Fragment key={i}>{i % 2 === 1 ? parts[piece] : piece}</Fragment>);
}

// The mock's "three words pressed" scene starts where a person would be
// after pressing three words. Nothing here runs in a real build.
function scenePicks(cloud: TopicCloud): string[] {
  const scene = mockScene();
  // Two words pressed before the titles were offered (D-71's "press, then offer").
  if (scene === "topics-picked") return ["資金繰り", "撤退基準"].filter((w) => cloud.words.some((x) => x.word === w));
  if (scene !== "topics-cloud-picked") return [];
  const wanted = ["採用", "定着", "評価"].filter((w) => cloud.words.some((x) => x.word === w));
  return (wanted.length === MAX_WORDS ? wanted : cloud.words.slice(0, MAX_WORDS).map((w) => w.word));
}

function PolicyRow({ label, value, placeholder, onChange, onBlur, inputRef }: { label: string; value: string; placeholder: string; onChange: (v: string) => void; onBlur: () => void; inputRef?: Ref<HTMLInputElement> }) {
  return (
    <label className="pf">
      <span>{label}</span>
      <input ref={inputRef} className="v" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </label>
  );
}
