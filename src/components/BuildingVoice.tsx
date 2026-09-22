import { useEffect, useState } from "react";
import { host, type VoiceProgress } from "../platform/host";
import { t } from "../i18n";

// The stage display is a presentation device (D-26): Codex reports only a
// handful of coarse events over a ~60 s run, so the middle stage advances
// on a timer rather than on real progress. Say so in the hint text.
const STAGES: VoiceProgress["stage"][] = ["started", "thinking", "extracted", "saved"];

export function BuildingVoice({ onCancel }: { onCancel: () => void }) {
  const [reached, setReached] = useState<VoiceProgress["stage"]>("started");

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void host.onVoiceProgress((p) => setReached(p.stage)).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  const current = STAGES.indexOf(reached);
  return (
    <div className="building" aria-live="polite">
      <div className="row between">
        <h2>{t("voice.building.title")}</h2>
        <button className="btn" onClick={onCancel}>{t("voice.building.cancel")}</button>
      </div>
      <ol className="stages">
        {STAGES.map((s, i) => (
          <li key={s} className={i < current ? "done" : i === current ? "active" : ""} aria-current={i === current ? "step" : undefined}>
            {t(`voice.stage.${s}` as const)}
          </li>
        ))}
      </ol>
      <p className="muted small">{t("voice.building.hint")}</p>
    </div>
  );
}
