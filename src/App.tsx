import { useCallback, useEffect, useState } from "react";
import { host, type CodexStatus, type SessionStatus } from "./platform/host";
import { t } from "./i18n";
import { VoiceSection } from "./components/VoiceSection";
import "./App.css";

const CODEX_INSTALL_URL = "https://developers.openai.com/codex/cli";

type View = { kind: "checking" } | { kind: "done"; status: CodexStatus };
type Auth =
  | { kind: "checking" }
  | { kind: "waiting" }
  | { kind: "done"; status: SessionStatus; error?: string };

export default function App() {
  const [view, setView] = useState<View>({ kind: "checking" });
  const [auth, setAuth] = useState<Auth>({ kind: "checking" });

  const loadSession = useCallback(async () => {
    try {
      setAuth({ kind: "done", status: await host.sessionStatus() });
    } catch (e) {
      setAuth({ kind: "done", status: { status: "signed_out" }, error: String(e) });
    }
  }, []);

  const signIn = useCallback(async () => {
    setAuth({ kind: "waiting" });
    try {
      setAuth({ kind: "done", status: await host.signIn() });
    } catch (e) {
      setAuth({ kind: "done", status: { status: "signed_out" }, error: String(e) });
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      setAuth({ kind: "done", status: await host.signOut() });
    } catch (e) {
      setAuth({ kind: "done", status: { status: "signed_out" }, error: String(e) });
    }
  }, []);

  const check = useCallback(async () => {
    setView({ kind: "checking" });
    try {
      setView({ kind: "done", status: await host.codexStatus() });
    } catch (e) {
      setView({ kind: "done", status: { status: "error", message: String(e) } });
    }
  }, []);

  useEffect(() => {
    void check();
    // The native side refreshes the stored session on launch; give it a
    // moment before the first read so we do not flash "signed out".
    const timer = setTimeout(() => void loadSession(), 400);
    return () => clearTimeout(timer);
  }, [check, loadSession]);

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Lita</h1>
        <p className="tagline">{t("app.tagline")}</p>
      </header>

      <section className="card" aria-live="polite">
        <SessionBody auth={auth} onSignIn={signIn} onSignOut={signOut} />
      </section>

      <section className="card" aria-live="polite">
        {view.kind === "checking" ? (
          <p className="muted">{t("codex.checking")}</p>
        ) : (
          <StatusBody status={view.status} onRetry={check} />
        )}
      </section>

      {auth.kind === "done" && auth.status.status === "signed_in" && view.kind === "done" && view.status.status === "ready" && (
        <section className="card">
          <VoiceSection />
        </section>
      )}

      <footer className="privacy">{t("privacy.note")}</footer>
    </main>
  );
}

function SessionBody({ auth, onSignIn, onSignOut }: { auth: Auth; onSignIn: () => void; onSignOut: () => void }) {
  if (auth.kind === "checking") return <p className="muted">{t("session.checking")}</p>;
  if (auth.kind === "waiting") return <p className="muted">{t("session.waiting")}</p>;
  if (auth.status.status === "signed_in") {
    return (
      <div className="row">
        <p className="ok">{t("session.signedIn", { email: auth.status.email ?? "" })}</p>
        <button className="secondary" onClick={onSignOut}>{t("action.signOut")}</button>
      </div>
    );
  }
  return (
    <>
      <p>{t("session.signedOut")}</p>
      {auth.error && (
        <>
          <p className="warn">{t("session.error")}</p>
          <pre>{auth.error}</pre>
        </>
      )}
      <button onClick={onSignIn}>{t("action.signIn")}</button>
    </>
  );
}

function StatusBody({ status, onRetry }: { status: CodexStatus; onRetry: () => void }) {
  switch (status.status) {
    case "ready":
      return <p className="ok">{t("codex.ready", { version: status.version })}</p>;
    case "not_logged_in":
      return (
        <>
          <p className="warn">{t("codex.notLoggedIn", { version: status.version })}</p>
          <p className="muted">{t("codex.notLoggedIn.hint")}</p>
          <pre>codex login</pre>
          <button onClick={onRetry}>{t("action.retry")}</button>
        </>
      );
    case "not_installed":
      return (
        <>
          <p className="warn">{t("codex.notInstalled")}</p>
          <p className="muted">{t("codex.notInstalled.hint")}</p>
          <div className="actions">
            <button onClick={() => void host.openExternal(CODEX_INSTALL_URL)}>{t("action.install")}</button>
            <button onClick={onRetry}>{t("action.retry")}</button>
          </div>
        </>
      );
    case "error":
      return (
        <>
          <p className="warn">{t("codex.error")}</p>
          <pre>{status.message}</pre>
          <button onClick={onRetry}>{t("action.retry")}</button>
        </>
      );
  }
}
