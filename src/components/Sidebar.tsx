import { useEffect, useRef, useState } from "react";
import type { ArticleStatus, CodexStatus, SessionStatus } from "../platform/host";
import { t } from "../i18n";
import type { Route } from "./Shell";

type Props = {
  route: Route;
  onRoute: (r: Route) => void;
  onNew: () => void;
  session: SessionStatus | null;
  codex: CodexStatus | null;
  codexChecking: boolean;
  onSignOut: () => void;
  onShowCodexSteps: () => void;
};

const FILTERS: (ArticleStatus | "all")[] = ["all", "draft", "approved", "archived"];

// Quiet when everything is fine; the Codex pill appears only when it is not.
export function Sidebar({ route, onRoute, onNew, session, codex, codexChecking, onSignOut, onShowCodexSteps }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const email = session?.status === "signed_in" ? session.email ?? "" : "";
  const codexOk = codex?.status === "ready";
  const pill =
    codexChecking ? null
    : codex?.status === "not_logged_in" ? t("codex.pill.notLoggedIn")
    : codex?.status === "not_installed" ? t("codex.pill.notInstalled")
    : codex?.status === "error" ? t("codex.pill.error")
    : null;
  const inArticles = route.kind === "articles" || route.kind === "article";
  const filter = route.kind === "articles" ? route.filter : null;

  return (
    <nav className="sidebar" aria-label={t("nav.label")}>
      <div className="side-top">
        <b className="wordmark">Lita</b>
        <button className="btn pri sm new" onClick={onNew}>{t("article.new")}</button>
      </div>

      <div className="side-group">
        <button className={inArticles ? "side-head on" : "side-head"} onClick={() => onRoute({ kind: "articles", filter: "all" })}>{t("nav.articles")}</button>
        <ul className="side-list">
          {FILTERS.map((f) => (
            <li key={f}>
              <button className={filter === f ? "side-item on" : "side-item"} aria-current={filter === f ? "page" : undefined} onClick={() => onRoute({ kind: "articles", filter: f })}>
                {t(`article.filter.${f}` as const)}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="side-group">
        <button className={route.kind === "voices" ? "side-head on" : "side-head"} aria-current={route.kind === "voices" ? "page" : undefined} onClick={() => onRoute({ kind: "voices" })}>{t("nav.voices")}</button>
      </div>

      <div className="side-bottom">
        {pill && (
          <div className="pill warn side-pill">
            <span>{pill}</span>
            <button className="link" onClick={onShowCodexSteps}>{t("action.seeSteps")}</button>
          </div>
        )}
        <div className="acct-wrap" ref={ref}>
          <button className="acct" aria-haspopup="menu" aria-expanded={open} aria-label={t("account.menu")} onClick={() => setOpen((o) => !o)}>
            <span className="avatar" aria-hidden="true">{(email[0] ?? "?").toUpperCase()}</span>
            <span className="acct-email">{email}</span>
          </button>
          {open && (
            <div className="menu up" role="menu">
              <div className="menu-meta">{email}</div>
              <div className="menu-meta">{codexOk ? t("status.codexOk") : t("status.codexNotOk")}</div>
              <button role="menuitem" className="menu-item" onClick={() => { setOpen(false); onSignOut(); }}>{t("action.signOut")}</button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
