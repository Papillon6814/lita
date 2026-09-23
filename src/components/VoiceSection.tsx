import { useCallback, useEffect, useState } from "react";
import { host, type SourceInput, type UiError, type Voice, type VoiceSummary } from "../platform/host";
import { mockScene } from "../platform/mock";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { VoiceIntake } from "./VoiceIntake";
import { BuildingVoice } from "./BuildingVoice";
import { VoicePortrait } from "./VoicePortrait";
import { VoiceList } from "./VoiceList";

// Voices (D-44, simplified 2026-09-23 after the UX review, D-53..D-56):
// most people keep one or two. With none, the intake is the whole screen;
// with exactly one, the voice page opens straight away; the list only
// appears once there are two or more.
type State =
  | { kind: "loading" }
  | { kind: "list"; names: string[] }
  | { kind: "new"; error?: UiError; first: boolean; names: string[] }
  | { kind: "building"; first: boolean; names: string[] }
  | { kind: "voice"; voice: Voice; count: number; names: string[] };

export function VoiceSection({ onWrite }: { onWrite: (voiceId: string) => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const openVoice = useCallback(async (id: string, list: VoiceSummary[]) => {
    const v = await host.getVoice(id).catch(() => null);
    const names = list.map((x) => x.name);
    setState(v ? { kind: "voice", voice: v, count: list.length, names } : { kind: "list", names });
  }, []);

  const start = useCallback(async (prefer?: string) => {
    setState({ kind: "loading" });
    try {
      const list = await host.listVoices();
      const names = list.map((x) => x.name);
      const scene = mockScene();
      if (scene === "building") return setState({ kind: "building", first: list.length === 0, names });
      if (scene?.startsWith("intake")) return setState({ kind: "new", first: list.length === 0, names });
      if (list.length === 0) return setState({ kind: "new", first: true, names });
      if (scene?.startsWith("voices")) return setState({ kind: "list", names });
      if (prefer || list.length === 1 || scene?.startsWith("voice")) return openVoice(prefer ?? list[0].id, list);
      setState({ kind: "list", names });
    } catch (e) {
      setState({ kind: "new", error: asUiError(e), first: true, names: [] });
    }
  }, [openVoice]);
  useEffect(() => { void start(); }, [start]);

  const build = useCallback(async (name: string, sources: SourceInput[], first: boolean, names: string[]) => {
    setState({ kind: "building", first, names });
    try {
      const voice = await host.createVoice(name, sources);
      await start(voice.id);
    } catch (e) {
      const error = asUiError(e);
      setState({ kind: "new", error: error.code === "cancelled" ? undefined : error, first, names });
    }
  }, [start]);

  const remove = useCallback(async (voice: Voice) => {
    if (!window.confirm(t("voice.deleteConfirm"))) return;
    try { await host.deleteVoice(voice.id); await start(); }
    catch (e) { alert(asUiError(e).detail); }
  }, [start]);

  switch (state.kind) {
    case "loading": return <p className="muted">{t("voice.loading")}</p>;
    case "list": return <VoiceList onOpen={(id) => void host.listVoices().then((l) => openVoice(id, l))} onNew={() => setState({ kind: "new", first: false, names: state.names })} />;
    case "new":
      return (
        <div>
          {!state.first && <button className="back" onClick={() => void start()}>← {t("nav.voices")}</button>}
          <VoiceIntake existing={state.names} onBuild={(name, sources) => void build(name, sources, state.first, state.names)} error={state.error} />
        </div>
      );
    case "building": return <BuildingVoice onCancel={() => void host.cancelVoiceBuild()} />;
    case "voice":
      return (
        <div className="voice-page">
          {state.count > 1 && <button className="back" onClick={() => setState({ kind: "list", names: state.names })}>← {t("nav.voices")}</button>}
          <VoicePortrait
            voice={state.voice}
            onChange={(voice) => setState({ ...state, voice })}
            onDelete={() => void remove(state.voice)}
            onWrite={() => onWrite(state.voice.id)}
          />
          <p className="voice-foot">
            <button className="link" onClick={() => setState({ kind: "new", first: false, names: state.names })}>{t("voice.another")}</button>
          </p>
        </div>
      );
  }
}
