import { useEffect, useState } from "react";
import { host, type ArticleStatus, type ArticleSummary, type Platform, type UiError, type VoiceSummary } from "../platform/host";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { ErrorNote } from "./ErrorNote";

type Props = { filter: ArticleStatus | "all"; onOpen: (id: string) => void; onNew: () => void };
type State = { kind: "loading" } | { kind: "ready"; rows: ArticleSummary[] } | { kind: "error"; error: UiError };

// The home screen: what has been written, newest first. Nothing on it is a
// number for its own sake; dates and destinations only.
export function ArticleList({ filter, onOpen, onNew }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [voices, setVoices] = useState<VoiceSummary[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    void host.listArticles(filter === "all" ? undefined : filter)
      .then((rows) => { if (live) setState({ kind: "ready", rows }); })
      .catch((e) => { if (live) setState({ kind: "error", error: asUiError(e) }); });
    return () => { live = false; };
  }, [filter]);
  useEffect(() => { void host.platforms().then(setPlatforms).catch(() => {}); void host.listVoices().then(setVoices).catch(() => {}); }, []);

  const platformName = (id: string) => platforms.find((p) => p.id === id)?.name ?? id;
  const voiceName = (id: string | null) => voices.find((v) => v.id === id)?.name ?? "";
  const needle = q.trim().toLowerCase();
  const rows = state.kind === "ready" ? state.rows.filter((r) => !needle || (r.title + " " + r.excerpt).toLowerCase().includes(needle)) : [];
  const nothingAtAll = state.kind === "ready" && state.rows.length === 0;

  return (
    <div className="articles">
      <div className="page-head">
        <h2>{t(`article.filter.${filter}` as const)}</h2>
        {!nothingAtAll && <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("article.search")} aria-label={t("article.search")} />}
      </div>

      {state.kind === "loading" && <p className="muted">{t("article.loading")}</p>}
      {state.kind === "error" && <ErrorNote error={state.error} />}

      {nothingAtAll && (
        <div className="empty">
          <p className="lead-sm">{filter === "all" ? t("article.emptyAll") : t("article.emptyFilter")}</p>
          {filter === "all" && <button className="btn pri" onClick={onNew}>{t("article.new")}</button>}
        </div>
      )}

      {state.kind === "ready" && !nothingAtAll && (
        rows.length === 0 ? <p className="muted">{t("article.noMatch")}</p> : (
          <ul className="article-rows">
            {rows.map((a) => (
              <li key={a.id}>
                <button className="article-row" onClick={() => onOpen(a.id)}>
                  <span className="a-title">{a.title.trim() || a.excerpt || t("article.untitled")}</span>
                  {a.title.trim() && a.excerpt && <span className="a-excerpt">{a.excerpt}</span>}
                  <span className="a-meta">
                    <span className="badge">{platformName(a.platform_id)}</span>
                    {a.status !== "draft" && <span className={`badge status-${a.status}`}>{t(`article.status.${a.status}` as const)}</span>}
                    {voiceName(a.voice_id) && <span>{voiceName(a.voice_id)}</span>}
                    <span>{relativeDate(a.updated_at)}</span>
                  </span>
                </button>
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
