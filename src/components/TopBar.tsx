import { useEffect, useRef, useState } from "react";
import type { CodexStatus, SessionStatus } from "../platform/host";
import { t } from "../i18n";

type Props = {
  session: SessionStatus | null;
  codex: CodexStatus | null;
  codexChecking: boolean;
  onSignOut: () => void;
  onShowCodexSteps: () => void;
};

// Quiet when everything is fine; a labelled pill only when something is not.
export function TopBar({ session, codex, codexChecking, onSignOut, onShowCodexSteps }: Props) {
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

  const signedIn = session?.status === "signed_in";
  const email = signedIn && session.status === "signed_in" ? session.email ?? "" : "";
  const initial = (email[0] ?? "?").toUpperCase();
  const codexOk = codex?.status === "ready";
  const pill =
    codexChecking ? t("codex.pill.checking")
    : codex?.status === "not_logged_in" ? t("codex.pill.notLoggedIn")
    : codex?.status === "not_installed" ? t("codex.pill.notInstalled")
    : codex?.status === "config_broken" ? t("codex.pill.configBroken")
    : codex?.status === "error" ? t("codex.pill.error")
    : null;

  return (
    <header className="topbar">
      <b className="wordmark">Lita</b>
      <div className="topbar-right">
        {signedIn && pill && (
          <span className={codexChecking ? "pill quiet" : "pill warn"}>
            {pill}
            {!codexChecking && <button className="link" onClick={onShowCodexSteps}>{t("action.seeSteps")}</button>}
          </span>
        )}
        {signedIn && (
          <div className="acct-wrap" ref={ref}>
            <button className="acct" aria-haspopup="menu" aria-expanded={open} aria-label={t("account.menu")} onClick={() => setOpen((o) => !o)}>
              <span className="avatar" aria-hidden="true">{initial}</span>
              <span className="caret" aria-hidden="true">▾</span>
            </button>
            {open && (
              <div className="menu" role="menu">
                <div className="menu-meta">{email}</div>
                <div className="menu-meta">{codexOk ? t("status.codexOk") : t("status.codexNotOk")}</div>
                <button role="menuitem" className="menu-item" onClick={() => { setOpen(false); onSignOut(); }}>{t("action.signOut")}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
