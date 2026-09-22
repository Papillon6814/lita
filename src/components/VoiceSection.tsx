import { useCallback, useEffect, useState } from "react";
import { host, type SourceInput, type UiError, type Voice } from "../platform/host";
import { mockScene } from "../platform/mock";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { VoiceIntake } from "./VoiceIntake";
import { BuildingVoice } from "./BuildingVoice";
import { VoicePortrait } from "./VoicePortrait";
import { WriteScreen } from "./WriteScreen";

// v0.1 is one voice (D-13): the first one in the list is "the" voice.
type State = { kind: "loading" } | { kind: "none"; error?: UiError } | { kind: "building" } | { kind: "ready"; voice: Voice } | { kind: "write"; voice: Voice };

export function VoiceSection() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const [first] = await host.listVoices();
      if (!first) return setState({ kind: mockScene() === "building" ? "building" : "none" });
      const voice = await host.getVoice(first.id);
      const scene = mockScene();
      if (voice && scene?.startsWith("write")) return setState({ kind: "write", voice });
      setState(voice ? { kind: "ready", voice } : { kind: "none" });
    } catch (e) {
      setState({ kind: "none", error: asUiError(e) });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const build = useCallback(async (name: string, sources: SourceInput[]) => {
    setState({ kind: "building" });
    try { setState({ kind: "ready", voice: await host.createVoice(name, sources) }); }
    catch (e) {
      const error = asUiError(e);
      setState({ kind: "none", error: error.code === "cancelled" ? undefined : error });
    }
  }, []);

  const startOver = useCallback(async (voice: Voice) => {
    if (!window.confirm(t("voice.startOverConfirm"))) return;
    try { await host.deleteVoice(voice.id); setState({ kind: "none" }); }
    catch (e) { setState({ kind: "ready", voice }); alert(asUiError(e).detail); }
  }, []);

  switch (state.kind) {
    case "loading": return <p className="muted">{t("voice.loading")}</p>;
    case "none": return <VoiceIntake onBuild={build} error={state.error} />;
    case "building": return <BuildingVoice onCancel={() => void host.cancelVoiceBuild()} />;
    case "ready":
      return (
        <VoicePortrait
          voice={state.voice}
          onChange={(voice) => setState({ kind: "ready", voice })}
          onStartOver={() => void startOver(state.voice)}
          onWrite={() => setState({ kind: "write", voice: state.voice })}
        />
      );
    case "write":
      return <WriteScreen voice={state.voice} onBack={() => setState({ kind: "ready", voice: state.voice })} />;
  }
}
