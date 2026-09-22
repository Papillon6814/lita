import type { UiError } from "../platform/host";
import { describe } from "../errors";
import { t } from "../i18n";

/// A plain sentence first; the raw detail only behind a disclosure.
export function ErrorNote({ error }: { error: UiError }) {
  return (
    <div className="error" role="alert">
      <p className="warn">{describe(error)}</p>
      {error.detail && (
        <details>
          <summary>{t("action.showDetails")}</summary>
          <pre>{error.detail}</pre>
        </details>
      )}
    </div>
  );
}
