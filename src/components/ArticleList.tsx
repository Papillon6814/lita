import { useCallback, useEffect, useState } from "react";
import { host, type ArticleStatus, type ArticleSummary, type Platform, type UiError, type VoiceSummary } from "../platform/host";
import { asUiError } from "../errors";
import { t } from "../i18n";
import type { MessageKey } from "../i18n/en";
import { ErrorNote } from "./ErrorNote";

type Props = {
  filter: ArticleStatus | "all";
  onOpen: (id: string) => void;
  onNew: () => void;
  onGoVoices: () => void;
  onGoTopics: () => void;
  onShowCodexSteps: () => void;
};
type State = { kind: "loading" } | { kind: "ready"; rows: ArticleSummary[] } | { kind: "error"; error: UiError };

// When the whole queue stops, the sentence says what to do next, not what
// went wrong: the sidebar already carries the cause.
const STOPPED: Record<string, MessageKey> = {
  codex_not_logged_in: "queue.stopped.codex_not_logged_in",
  not_signed_in: "queue.stopped.not_signed_in",
  session_expired: "queue.stopped.session_expired",
  network: "queue.stopped.network",
};

// The home screen: what has been written, newest first. Nothing on it is a
// number for its own sake; dates and destinations only.
export function ArticleList({ filter, onOpen, onNew, onGoVoices, onGoTopics, onShowCodexSteps }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [voices, setVoices] = useState<VoiceSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [stopped, setStopped] = useState<UiError | null>(null);

  // Re-listing after a queue event must not blank the screen.
  const reload = useCallback(async () => {
    const rows = await host.listArticles(filter === "all" ? undefined : filter);
    setState({ kind: "ready", rows });
  }, [filter]);

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    void host.listArticles(filter === "all" ? undefined : filter)
      .then((rows) => { if (live) setState({ kind: "ready", rows }); })
      .catch((e) => { if (live) setState({ kind: "error", error: asUiError(e) }); });
    return () => { live = false; };
  }, [filter]);
  useEffect(() => { void host.platforms().then(setPlatforms).catch(() => {}); void host.listVoices().then(setVoices).catch(() => {}); }, []);

  useEffect(() => {
    let live = true;
    let off: (() => void) | undefined;
    void host.onQueueEvent((e) => {
      if (!live) return;
      if (e.kind === "stopped") { setStopped(e.error); void reload().catch(() => {}); return; }
      setStopped(null);
      void reload().catch(() => {});
    }).then((u) => { if (live) off = u; else u(); }).catch(() => {});
    return () => { live = false; off?.(); };
  }, [reload]);

  const platformName = (id: string) => platforms.find((p) => p.id === id)?.name ?? id;
  const voiceName = (id: string | null) => voices?.find((v) => v.id === id)?.name ?? "";
  const noVoice = voices !== null && voices.length === 0;
  const needle = q.trim().toLowerCase();
  const rows = state.kind === "ready" ? state.rows.filter((r) => !needle || (r.title + " " + r.excerpt).toLowerCase().includes(needle)) : [];
  const nothingAtAll = state.kind === "ready" && state.rows.length === 0;
  const inQueue = state.kind === "ready" ? state.rows.filter((r) => r.queue === "waiting" || r.queue === "writing").length : 0;

  const drop = async (id: string) => { try { await host.dequeueArticle(id); await reload(); } catch (e) { setState({ kind: "error", error: asUiError(e) }); } };
  const clear = async () => { try { await host.clearQueue(); await reload(); } catch (e) { setState({ kind: "error", error: asUiError(e) }); } };

  return (
    <div className="articles">
      <div className="page-head">
        <h2>{t(`article.filter.${filter}` as const)}</h2>
        <div className="head-right">
          {!nothingAtAll && <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("article.search")} aria-label={t("article.search")} />}
          {!noVoice && <button className="btn sm" onClick={onGoTopics}>{t("topics.suggest")}</button>}
        </div>
      </div>

      {stopped && (
        <p className="notice" role="status">
          {t(STOPPED[stopped.code] ?? "queue.stopped")}
          {stopped.code === "codex_not_logged_in" && <button className="link" onClick={onShowCodexSteps}>{t("action.seeSteps")}</button>}
        </p>
      )}
      {/* While it is stopped, one sentence is enough; the rows still say
          which of them are waiting. */}
      {inQueue > 0 && !stopped && (
        <p className="saved" role="status">
          {t("queue.queued", { n: String(inQueue) })}
          <button className="link" onClick={() => void clear()}>{t("queue.clear")}</button>
        </p>
      )}

      {state.kind === "loading" && <p className="muted">{t("article.loading")}</p>}
      {state.kind === "error" && <ErrorNote error={state.error} />}

      {nothingAtAll && (
        <div className="empty">
          {noVoice ? (
            <>
              <p className="lead-sm">{t("article.emptyNoVoice")}</p>
              <button className="btn pri" onClick={onGoVoices}>{t("article.goVoices")}</button>
            </>
          ) : (
            <>
              <p className="lead-sm">{filter === "all" ? t("article.emptyAll") : t("article.emptyFilter")}</p>
              {filter === "all" && <button className="btn pri" onClick={onNew}>{t("article.new")}</button>}
            </>
          )}
        </div>
      )}

      {state.kind === "ready" && !nothingAtAll && (
        rows.length === 0 ? <p className="muted">{t("article.noMatch")}</p> : (
          <ul className="article-rows">
            {rows.map((a) => (
              <li key={a.id} className="arow">
                <button className="article-row" onClick={() => onOpen(a.id)}>
                  <span className="a-title">{a.title.trim() || a.excerpt || t("article.untitled")}</span>
                  {a.title.trim() && a.excerpt && <span className="a-excerpt">{a.excerpt}</span>}
                  <span className="a-meta">
                    <span className="badge">{platformName(a.platform_id)}</span>
                    {a.status !== "draft" && <span className={`badge status-${a.status}`}>{t(`article.status.${a.status}` as const)}</span>}
                    {a.queue === "writing" && <span className="badge now"><span className="spinner" aria-hidden="true" />{t("queue.writing")}</span>}
                    {a.queue === "waiting" && <span className="badge status-archived">{t("queue.waiting")}</span>}
                    {a.queue === "failed" && <span className="badge status-archived">{t("queue.failed")}</span>}
                    {voiceName(a.voice_id) && <span>{voiceName(a.voice_id)}</span>}
                    <span>{relativeDate(a.updated_at)}</span>
                  </span>
                </button>
                {(a.queue === "writing" || a.queue === "waiting") && (
                  <span className="arow-act">
                    <button className="link quiet-link" onClick={() => void drop(a.id)}>{t(a.queue === "writing" ? "queue.stop" : "queue.drop")}</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

export function relativeDate(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return t("time.justNow");
  if (mins < 60) return t("time.minutesAgo", { n: String(mins) });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("time.hoursAgo", { n: String(hours) });
  const days = Math.round(hours / 24);
  if (days < 7) return t("time.daysAgo", { n: String(days) });
  return d.toLocaleDateString();
}
