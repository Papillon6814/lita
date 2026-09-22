import { useCallback, useEffect, useState } from "react";
import { host, type SourceInput, type UiError, type Voice } from "../platform/host";
import { mockScene } from "../platform/mock";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { VoiceIntake } from "./VoiceIntake";
import { BuildingVoice } from "./BuildingVoice";
import { VoicePortrait } from "./VoicePortrait";
import { VoiceList } from "./VoiceList";
import { TrialWrite } from "./TrialWrite";

// Voices (D-44): a list, one voice at a time, and the intake for a new one.
// With no voice at all, the intake is the whole screen.
type State =
  | { kind: "loading" }
  | { kind: "list" }
  | { kind: "new"; error?: UiError; first: boolean }
  | { kind: "building"; first: boolean }
  | { kind: "voice"; voice: Voice };

export function VoiceSection({ onWrite }: { onWrite: (voiceId: string) => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const start = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const list = await host.listVoices();
      const scene = mockScene();
      if (scene === "building") return setState({ kind: "building", first: list.length === 0 });
      if (scene?.startsWith("intake")) return setState({ kind: "new", first: list.length === 0 });
      if (list.length === 0) return setState({ kind: "new", first: true });
      if (scene?.startsWith("voice") && !scene.startsWith("voices")) {
        const v = await host.getVoice(list[0].id);
        return setState(v ? { kind: "voice", voice: v } : { kind: "list" });
      }
      setState({ kind: "list" });
    } catch (e) {
      setState({ kind: "new", error: asUiError(e), first: true });
    }
  }, []);
  useEffect(() => { void start(); }, [start]);

  const open = useCallback(async (id: string) => {
    const v = await host.getVoice(id).catch(() => null);
    setState(v ? { kind: "voice", voice: v } : { kind: "list" });
  }, []);

  const build = useCallback(async (name: string, sources: SourceInput[], first: boolean) => {
    setState({ kind: "building", first });
    try {
      const voice = await host.createVoice(name, sources);
      if (first) await host.setDefaultVoice(voice.id).catch(() => {});
      setState({ kind: "voice", voice });
    } catch (e) {
      const error = asUiError(e);
      setState({ kind: "new", error: error.code === "cancelled" ? undefined : error, first });
    }
  }, []);

  const remove = useCallback(async (voice: Voice) => {
    if (!window.confirm(t("voice.deleteConfirm"))) return;
    try { await host.deleteVoice(voice.id); await start(); }
    catch (e) { setState({ kind: "voice", voice }); alert(asUiError(e).detail); }
  }, [start]);

  switch (state.kind) {
    case "loading": return <p className="muted">{t("voice.loading")}</p>;
    case "list": return <VoiceList onOpen={(id) => void open(id)} onNew={() => setState({ kind: "new", first: false })} />;
    case "new":
      return (
        <div>
          {!state.first && <button className="back" onClick={() => setState({ kind: "list" })}>← {t("nav.voices")}</button>}
          <VoiceIntake onBuild={(name, sources) => void build(name, sources, state.first)} error={state.error} />
        </div>
      );
    case "building": return <BuildingVoice onCancel={() => void host.cancelVoiceBuild()} />;
    case "voice":
      return (
        <div className="voice-page">
          <button className="back" onClick={() => setState({ kind: "list" })}>← {t("nav.voices")}</button>
          <VoicePortrait
            voice={state.voice}
            onChange={(voice) => setState({ kind: "voice", voice })}
            onStartOver={() => void remove(state.voice)}
            onWrite={() => onWrite(state.voice.id)}
          />
          <TrialWrite voice={state.voice} />
        </div>
      );
  }
}
