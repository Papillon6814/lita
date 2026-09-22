import { useCallback, useEffect, useRef, useState } from "react";
import { host, type CodexStatus, type SessionStatus, type UiError } from "./platform/host";
import { asUiError } from "./errors";
import { t } from "./i18n";
import { ErrorNote } from "./components/ErrorNote";
import { TopBar } from "./components/TopBar";
import { VoiceSection } from "./components/VoiceSection";
import "./App.css";

const CODEX_INSTALL_URL = "https://developers.openai.com/codex/cli";

type View = { kind: "checking" } | { kind: "done"; status: CodexStatus };
type Auth = { kind: "checking" } | { kind: "waiting" } | { kind: "done"; status: SessionStatus; error?: UiError };

export default function App() {
  const [view, setView] = useState<View>({ kind: "checking" });
  const [auth, setAuth] = useState<Auth>({ kind: "checking" });
  const stepsRef = useRef<HTMLElement>(null);

  // The native side refreshes the stored session on launch; keep asking
  // until it has decided, so a slow network never shows as "signed out".
  const loadSession = useCallback(async () => {
    for (let i = 0; i < 100; i++) {
      try {
        const status = await host.sessionStatus();
        if (status.status !== "restoring") return setAuth({ kind: "done", status });
      } catch (e) {
        return setAuth({ kind: "done", status: { status: "signed_out" }, error: asUiError(e) });
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    setAuth({ kind: "done", status: { status: "signed_out" } });
  }, []);

  const signIn = useCallback(async () => {
    setAuth({ kind: "waiting" });
    try { setAuth({ kind: "done", status: await host.signIn() }); }
    catch (e) {
      const error = asUiError(e);
      setAuth({ kind: "done", status: { status: "signed_out" }, error: error.code === "cancelled" ? undefined : error });
    }
  }, []);

  const signOut = useCallback(async () => {
    try { setAuth({ kind: "done", status: await host.signOut() }); }
    catch (e) { setAuth({ kind: "done", status: { status: "signed_out" }, error: asUiError(e) }); }
  }, []);

  const check = useCallback(async () => {
    setView({ kind: "checking" });
    try { setView({ kind: "done", status: await host.codexStatus() }); }
    catch (e) { setView({ kind: "done", status: { status: "error", message: String(e) } }); }
  }, []);

  useEffect(() => {
    void check();
    void loadSession();
  }, [check, loadSession]);

  const session = auth.kind === "done" ? auth.status : null;
  const signedIn = session?.status === "signed_in";
  const codex = view.kind === "done" ? view.status : null;
  const codexReady = codex?.status === "ready";

  return (
    <div className="app">
      <TopBar
        session={session}
        codex={codex}
        codexChecking={view.kind === "checking"}
        onSignOut={() => void signOut()}
        onShowCodexSteps={() => stepsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />
      <main className="shell">
        {!signedIn && (
          <section className="panel">
            <h2>Lita</h2>
            <p className="sub">{t("app.tagline")}</p>
            <SessionBody auth={auth} onSignIn={() => void signIn()} onCancel={() => void host.cancelSignIn()} />
          </section>
        )}

        {signedIn && !codexReady && (
          <section className="panel" ref={stepsRef}>
            {view.kind === "checking" ? <p className="muted">{t("codex.checking")}</p> : <CodexSteps status={view.status} onRetry={() => void check()} />}
          </section>
        )}

        {signedIn && codexReady && <VoiceSection />}

        <footer className="privacy">{t("privacy.note")}</footer>
      </main>
    </div>
  );
}

function SessionBody({ auth, onSignIn, onCancel }: { auth: Auth; onSignIn: () => void; onCancel: () => void }) {
  if (auth.kind === "checking") return <p className="muted">{t("session.checking")}</p>;
  if (auth.kind === "waiting") {
    return (
      <div className="row between">
        <p className="muted">{t("session.waiting")}</p>
        <button className="btn" onClick={onCancel}>{t("action.cancel")}</button>
      </div>
    );
  }
  return (
    <>
      <p>{t("session.signedOut")}</p>
      {auth.error && <ErrorNote error={auth.error} />}
      <button className="btn pri" onClick={onSignIn}>{t("action.signIn")}</button>
    </>
  );
}

function CodexSteps({ status, onRetry }: { status: CodexStatus; onRetry: () => void }) {
  switch (status.status) {
    case "ready":
      return <p className="ok">{t("status.codexOk")}</p>;
    case "not_logged_in":
      return (
        <>
          <h2>{t("codex.notLoggedIn")}</h2>
          <p className="muted">{t("codex.notLoggedIn.hint")}</p>
          <pre>codex login</pre>
          <button className="btn pri" onClick={onRetry}>{t("action.retry")}</button>
        </>
      );
    case "not_installed":
      return (
        <>
          <h2>{t("codex.notInstalled")}</h2>
          <p className="muted">{t("codex.notInstalled.hint")}</p>
          <div className="row">
            <button className="btn pri" onClick={() => void host.openExternal(CODEX_INSTALL_URL)}>{t("action.install")}</button>
            <button className="btn" onClick={onRetry}>{t("action.retry")}</button>
          </div>
        </>
      );
    case "error":
      return (
        <>
          <ErrorNote error={{ code: "unknown", detail: status.message }} />
          <button className="btn pri" onClick={onRetry}>{t("action.retry")}</button>
        </>
      );
  }
}
