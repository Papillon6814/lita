import { useCallback, useEffect, useState } from "react";
import { host, type SourceInput, type Voice } from "../platform/host";
import { t } from "../i18n";
import { VoiceIntake } from "./VoiceIntake";
import { BuildingVoice } from "./BuildingVoice";
import { VoiceCard } from "./VoiceCard";

// v0.1 is one voice (D-13): the first one in the list is "the" voice.
type State =
  | { kind: "loading" }
  | { kind: "none"; error?: string }
  | { kind: "building" }
  | { kind: "ready"; voice: Voice };

export function VoiceSection() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const [first] = await host.listVoices();
      if (!first) return setState({ kind: "none" });
      const voice = await host.getVoice(first.id);
      setState(voice ? { kind: "ready", voice } : { kind: "none" });
    } catch (e) {
      setState({ kind: "none", error: String(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const build = useCallback(async (name: string, sources: SourceInput[]) => {
    setState({ kind: "building" });
    try {
      setState({ kind: "ready", voice: await host.createVoice(name, sources) });
    } catch (e) {
      setState({ kind: "none", error: String(e) });
    }
  }, []);

  const startOver = useCallback(async (voice: Voice) => {
    if (!window.confirm(t("voice.card.startOverConfirm"))) return;
    try {
      await host.deleteVoice(voice.id);
      setState({ kind: "none" });
    } catch (e) {
      setState({ kind: "ready", voice });
      alert(String(e));
    }
  }, []);

  switch (state.kind) {
    case "loading":
      return <p className="muted">{t("voice.loading")}</p>;
    case "none":
      return <VoiceIntake onBuild={build} error={state.error} />;
    case "building":
      return <BuildingVoice />;
    case "ready":
      return <VoiceCard voice={state.voice} onStartOver={() => void startOver(state.voice)} />;
  }
}
