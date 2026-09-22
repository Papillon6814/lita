import { useEffect, useState } from "react";
import { host, type Article, type ArticleVersion, type UiError, type VersionKind } from "../platform/host";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { ErrorNote } from "./ErrorNote";
import { relativeDate } from "./ArticleList";

type Props = {
  article: Article;
  current: { title: string; body: string };
  onRestored: (a: Article) => void;
  onClose: () => void;
};

// Durable snapshots, newest first, with the current text always visible
// as the reference. Picking one previews it; restoring makes it current and
// keeps what was there (D-46), so nothing here is destructive.
export function VersionHistory({ article, current, onRestored, onClose }: Props) {
  const [versions, setVersions] = useState<ArticleVersion[] | null>(null);
  const [selected, setSelected] = useState<ArticleVersion | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => host.listVersions(article.id).then(setVersions).catch((e) => setError(asUiError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [article.id]);

  const keep = async () => {
    setBusy(true);
    try { await host.snapshotArticle(article.id, true); await load(); } catch (e) { setError(asUiError(e)); } finally { setBusy(false); }
  };
  const restore = async (v: ArticleVersion) => {
    if (!window.confirm(t("versions.restoreConfirm", { when: relativeDate(v.created_at) }))) return;
    setBusy(true);
    try { const a = await host.restoreVersion(v.id); onRestored(a); setSelected(null); await load(); } catch (e) { setError(asUiError(e)); } finally { setBusy(false); }
  };

  // Only the newest version with the current text is "current"; older
  // identical ones are just history.
  const currentId = versions?.find((v) => v.body === current.body && v.title === current.title)?.id ?? null;
  const isCurrent = (v: ArticleVersion) => v.id === currentId;

  return (
    <aside className="versions">
      <div className="row between">
        <h3>{t("versions.title")}</h3>
        <button className="quiet sm" onClick={onClose}>{t("action.done")}</button>
      </div>
      <p className="hint">{t("versions.hint")}</p>
      <button className="btn sm" disabled={busy} onClick={() => void keep()}>{t("versions.keep")}</button>
      {error && <ErrorNote error={error} />}
      {versions === null ? <p className="muted small">{t("article.loading")}</p> : versions.length === 0 ? (
        <p className="muted small">{t("versions.none")}</p>
      ) : (
        <ul className="version-list">
          {versions.map((v) => (
            <li key={v.id}>
              <button className={selected?.id === v.id ? "version on" : "version"} onClick={() => setSelected(selected?.id === v.id ? null : v)} aria-pressed={selected?.id === v.id}>
                <span className="v-kind">{t(`versions.kind.${v.kind}` as `versions.kind.${VersionKind}`)}</span>
                <span className="v-when">{relativeDate(v.created_at)}</span>
                {isCurrent(v) && <span className="badge">{t("versions.current")}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="version-preview">
          {selected.title && <div className="v-title">{selected.title}</div>}
          <pre className="v-body">{selected.body}</pre>
          {!isCurrent(selected) && <button className="btn pri sm" disabled={busy} onClick={() => void restore(selected)}>{t("versions.restore")}</button>}
        </div>
      )}
    </aside>
  );
}
