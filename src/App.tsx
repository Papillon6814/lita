import { useCallback, useEffect, useState } from "react";
import { host, type CodexStatus, type SessionStatus, type UiError } from "./platform/host";
import { asUiError } from "./errors";
import { t } from "./i18n";
import { ErrorNote } from "./components/ErrorNote";
import { VoiceSection } from "./components/VoiceSection";
import "./App.css";

const CODEX_INSTALL_URL = "https://developers.openai.com/codex/cli";

type View = { kind: "checking" } | { kind: "done"; status: CodexStatus };
type Auth =
  | { kind: "checking" }
  | { kind: "waiting" }
  | { kind: "done"; status: SessionStatus; error?: UiError };

export default function App() {
  const [view, setView] = useState<View>({ kind: "checking" });
  const [auth, setAuth] = useState<Auth>({ kind: "checking" });

  const loadSession = useCallback(async () => {
    try {
      setAuth({ kind: "done", status: await host.sessionStatus() });
    } catch (e) {
      setAuth({ kind: "done", status: { status: "signed_out" }, error: asUiError(e) });
    }
  }, []);

  const signIn = useCallback(async () => {
    setAuth({ kind: "waiting" });
    try {
      setAuth({ kind: "done", status: await host.signIn() });
    } catch (e) {
      const error = asUiError(e);
      // A cancel is the person's own choice; no need to call it an error.
      setAuth({ kind: "done", status: { status: "signed_out" }, error: error.code === "cancelled" ? undefined : error });
    }
  }, []);

  const cancelSignIn = useCallback(() => void host.cancelSignIn(), []);

  const signOut = useCallback(async () => {
    try {
      setAuth({ kind: "done", status: await host.signOut() });
    } catch (e) {
      setAuth({ kind: "done", status: { status: "signed_out" }, error: asUiError(e) });
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

  const signedIn = auth.kind === "done" && auth.status.status === "signed_in";
  const codexReady = view.kind === "done" && view.status.status === "ready";
  const allGood = signedIn && codexReady;

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <h1>Lita</h1>
          <p className="tagline">{t("app.tagline")}</p>
        </div>
        {/* R-3: once everything is fine, status shrinks to one quiet line. */}
        {allGood && auth.kind === "done" && auth.status.status === "signed_in" && (
          <div className="status-strip" aria-live="polite">
            <span className="ok">{t("status.codexOk")}</span>
            <span className="muted">{t("status.signedInAs", { email: auth.status.email ?? "" })}</span>
            <button className="link" onClick={signOut}>{t("action.signOut")}</button>
          </div>
        )}
      </header>

      {!signedIn && (
        <section className="card" aria-live="polite">
          <SessionBody auth={auth} onSignIn={signIn} onCancel={cancelSignIn} />
        </section>
      )}

      {!codexReady && (
        <section className="card" aria-live="polite">
          {view.kind === "checking" ? (
            <p className="muted">{t("codex.checking")}</p>
          ) : (
            <StatusBody status={view.status} onRetry={check} />
          )}
        </section>
      )}

      {allGood && (
        <section className="card">
          <VoiceSection />
        </section>
      )}

      <footer className="privacy">{t("privacy.note")}</footer>
    </main>
  );
}

function SessionBody({ auth, onSignIn, onCancel }: { auth: Auth; onSignIn: () => void; onCancel: () => void }) {
  if (auth.kind === "checking") return <p className="muted">{t("session.checking")}</p>;
  if (auth.kind === "waiting") {
    return (
      <div className="row">
        <p className="muted">{t("session.waiting")}</p>
        <button className="secondary" onClick={onCancel}>{t("action.cancel")}</button>
      </div>
    );
  }
  return (
    <>
      <p>{t("session.signedOut")}</p>
      {auth.error && <ErrorNote error={auth.error} />}
      <button onClick={onSignIn}>{t("action.signIn")}</button>
    </>
  );
}

function StatusBody({ status, onRetry }: { status: CodexStatus; onRetry: () => void }) {
  switch (status.status) {
    case "ready":
      return <p className="ok">{t("status.codexOk")}</p>;
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
            <button className="secondary" onClick={onRetry}>{t("action.retry")}</button>
          </div>
        </>
      );
    case "error":
      return (
        <>
          <ErrorNote error={{ code: "unknown", detail: status.message }} />
          <button onClick={onRetry}>{t("action.retry")}</button>
        </>
      );
  }
}
