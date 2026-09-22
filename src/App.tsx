import { useCallback, useEffect, useState } from "react";
import { host, type CodexStatus } from "./platform/host";
import { t } from "./i18n";
import "./App.css";

const CODEX_INSTALL_URL = "https://developers.openai.com/codex/cli";

type View = { kind: "checking" } | { kind: "done"; status: CodexStatus };

export default function App() {
  const [view, setView] = useState<View>({ kind: "checking" });

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
  }, [check]);

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Lita</h1>
        <p className="tagline">{t("app.tagline")}</p>
      </header>

      <section className="card" aria-live="polite">
        {view.kind === "checking" ? (
          <p className="muted">{t("codex.checking")}</p>
        ) : (
          <StatusBody status={view.status} onRetry={check} />
        )}
      </section>

      <footer className="privacy">{t("privacy.note")}</footer>
    </main>
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
