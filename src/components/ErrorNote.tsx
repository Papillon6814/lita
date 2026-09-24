import type { UiError } from "../platform/host";
import { describe } from "../errors";
import { t } from "../i18n";

/** Asks the app to run the sign-in flow again (#105). App.tsx listens. */
export const SIGN_IN_AGAIN = "lita:sign-in";

/// A plain sentence first; the raw detail only behind a disclosure. An
/// expired session gets the one action that fixes it.
export function ErrorNote({ error }: { error: UiError }) {
  const expired = error.code === "session_expired" || error.code === "not_signed_in";
  return (
    <div className="error" role="alert">
      <p className="warn">
        {describe(error)}
        {expired && <> <button className="link" onClick={() => window.dispatchEvent(new Event(SIGN_IN_AGAIN))}>{t("action.signInAgain")}</button></>}
      </p>
      {error.detail && !expired && (
        <details>
          <summary>{t("action.showDetails")}</summary>
          <pre>{error.detail}</pre>
        </details>
      )}
    </div>
  );
}
