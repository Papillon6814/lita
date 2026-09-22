import { useEffect, useState } from "react";
import { host, type DownloadEvent, type UiError, type UpdateInfo } from "../platform/host";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { ErrorNote } from "./ErrorNote";

export type UpdateState =
  | { kind: "checking" }
  | { kind: "latest"; version: string }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "downloading"; info: UpdateInfo; downloaded: number; total: number | null }
  | { kind: "ready"; info: UpdateInfo }
  | { kind: "error"; error: UiError };

// One small dialog for the whole update story: checking, nothing new,
// something new (with the release notes), downloading, restart.
export function UpdateDialog({ state, onState, onClose }: { state: UpdateState; onState: (s: UpdateState) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && state.kind !== "downloading") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose, state.kind]);

  const install = async () => {
    if (state.kind !== "available") return;
    const info = state.info;
    setBusy(true);
    onState({ kind: "downloading", info, downloaded: 0, total: null });
    try {
      await host.installUpdate((e: DownloadEvent) => {
        if (e.event === "started") onState({ kind: "downloading", info, downloaded: 0, total: e.data.content_length });
        else if (e.event === "progress") onState({ kind: "downloading", info, downloaded: e.data.downloaded, total: e.data.content_length });
        else onState({ kind: "ready", info });
      });
      onState({ kind: "ready", info });
    } catch (e) {
      onState({ kind: "error", error: asUiError(e) });
    } finally { setBusy(false); }
  };

  const pct = state.kind === "downloading" && state.total ? Math.min(100, Math.round((state.downloaded / state.total) * 100)) : null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && state.kind !== "downloading") onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="update-title">
        {state.kind === "checking" && <p id="update-title" className="modal-title">{t("update.checking")}</p>}
        {state.kind === "latest" && (
          <>
            <p id="update-title" className="modal-title">{t("update.latest", { v: state.version })}</p>
            <div className="modal-actions"><button className="btn pri" onClick={onClose}>{t("action.done")}</button></div>
          </>
        )}
        {state.kind === "available" && (
          <>
            <p id="update-title" className="modal-title">{t("update.available", { v: state.info.version })}</p>
            <p className="muted small">{t("update.current", { v: state.info.current_version })}</p>
            {state.info.notes && <pre className="notes-box">{state.info.notes}</pre>}
            <div className="modal-actions">
              <button className="btn pri" disabled={busy} onClick={() => void install()}>{t("update.install")}</button>
              <button className="quiet" onClick={onClose}>{t("update.later")}</button>
            </div>
          </>
        )}
        {state.kind === "downloading" && (
          <>
            <p id="update-title" className="modal-title">{t("update.downloading", { v: state.info.version })}</p>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
              <div className="progress-bar" style={{ width: `${pct ?? 10}%` }} />
            </div>
          </>
        )}
        {state.kind === "ready" && (
          <>
            <p id="update-title" className="modal-title">{t("update.ready", { v: state.info.version })}</p>
            <p className="muted small">{t("update.readyHint")}</p>
            <div className="modal-actions">
              <button className="btn pri" onClick={() => void host.restartApp()}>{t("update.restart")}</button>
              <button className="quiet" onClick={onClose}>{t("update.later")}</button>
            </div>
          </>
        )}
        {state.kind === "error" && (
          <>
            <p id="update-title" className="modal-title">{t("update.failed")}</p>
            <ErrorNote error={state.error} />
            <div className="modal-actions"><button className="btn" onClick={onClose}>{t("action.done")}</button></div>
          </>
        )}
      </div>
    </div>
  );
}
