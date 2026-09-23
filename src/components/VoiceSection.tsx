import { useCallback, useEffect, useState } from "react";
import { host, type SourceInput, type UiError, type Voice, type VoiceSummary } from "../platform/host";
import { mockScene } from "../platform/mock";
import { asUiError } from "../errors";
import { peek, prime, forget, voiceKey, VOICES_KEY } from "../hooks/useQuietLoad";
import { t } from "../i18n";
import { VoiceIntake } from "./VoiceIntake";
import { BuildingVoice } from "./BuildingVoice";
import { VoicePortrait } from "./VoicePortrait";
import { VoiceList } from "./VoiceList";
import { VoiceSources } from "./VoiceSources";
import { Delayed } from "./Delayed";

// Voices (D-44, simplified 2026-09-23 after the UX review, D-53..D-56):
// most people keep one or two. With none, the intake is the whole screen;
// with exactly one, the voice page opens straight away; the list only
// appears once there are two or more.
type State =
  | { kind: "loading" }
  | { kind: "list"; names: string[] }
  | { kind: "new"; error?: UiError; first: boolean; names: string[] }
  | { kind: "building"; first: boolean; names: string[] }
  | { kind: "rebuilding"; voice: Voice; count: number; names: string[] }
  | { kind: "voice"; voice: Voice; count: number; names: string[] };

type SectionProps = {
  onWrite: (voiceId: string) => void;
  /** Open this voice straight away (the editor's 調整する link). */
  voiceId?: string;
  /** Where 調整する came from, so there is one way back to the same article. */
  onBackToArticle?: () => void;
};

export function VoiceSection({ onWrite, voiceId, onBackToArticle }: SectionProps) {
  const [state, setState] = useState<State>({ kind: "loading" });

  // Opening a voice paints the remembered one first, then swaps in the
  // fresh copy when it lands: no blank step in between.
  const openVoice = useCallback(async (id: string, list: VoiceSummary[]) => {
    const names = list.map((x) => x.name);
    const remembered = peek<Voice | null>(voiceKey(id));
    if (remembered) setState({ kind: "voice", voice: remembered, count: list.length, names });
    const v = await host.getVoice(id).catch(() => null);
    prime(voiceKey(id), v);
    setState(v ? { kind: "voice", voice: v, count: list.length, names } : { kind: "list", names });
  }, []);

  // Which screen this is depends on how many voices there are. The answer
  // from last time decides straight away; the fresh list confirms it.
  const decide = useCallback(async (list: VoiceSummary[], prefer?: string) => {
    const names = list.map((x) => x.name);
    const scene = mockScene();
    if (scene === "building") return setState({ kind: "building", first: list.length === 0, names });
    if (scene?.startsWith("intake")) return setState({ kind: "new", first: list.length === 0, names });
    if (list.length === 0) return setState({ kind: "new", first: true, names });
    if (scene?.startsWith("voices")) return setState({ kind: "list", names });
    if (prefer || list.length === 1 || scene?.startsWith("voice")) return openVoice(prefer ?? list[0].id, list);
    setState({ kind: "list", names });
  }, [openVoice]);

  const start = useCallback(async (prefer?: string) => {
    const remembered = peek<VoiceSummary[]>(VOICES_KEY);
    if (remembered) void decide(remembered, prefer);
    else setState({ kind: "loading" });
    try {
      const list = await host.listVoices();
      prime(VOICES_KEY, list);
      await decide(list, prefer);
    } catch (e) {
      setState({ kind: "new", error: asUiError(e), first: true, names: [] });
    }
  }, [decide]);
  useEffect(() => { void start(voiceId); }, [start, voiceId]);

  const build = useCallback(async (name: string, sources: SourceInput[], first: boolean, names: string[]) => {
    setState({ kind: "building", first, names });
    try {
      const voice = await host.createVoice(name, sources);
      forget(VOICES_KEY); forget("voiceRows");
      prime(voiceKey(voice.id), voice);
      await start(voice.id);
    } catch (e) {
      const error = asUiError(e);
      setState({ kind: "new", error: error.code === "cancelled" ? undefined : error, first, names });
    }
  }, [start]);

  // Relearn the profile from everything the voice now holds (#68).
  const rebuild = useCallback(async (from: Extract<State, { kind: "voice" }>) => {
    setState({ kind: "rebuilding", voice: from.voice, count: from.count, names: from.names });
    try {
      const voice = await host.rebuildVoice(from.voice.id);
      prime(voiceKey(voice.id), voice);
      setState({ ...from, voice });
    } catch (e) {
      const error = asUiError(e);
      if (error.code !== "cancelled") alert(error.detail);
      setState(from);
    }
  }, []);

  const remove = useCallback(async (voice: Voice) => {
    if (!window.confirm(t("voice.deleteConfirm"))) return;
    try { await host.deleteVoice(voice.id); forget(VOICES_KEY); forget("voiceRows"); forget(voiceKey(voice.id)); await start(); }
    catch (e) { alert(asUiError(e).detail); }
  }, [start]);

  switch (state.kind) {
    // Nothing at all while it is quick; the sentence waits 300 ms.
    case "loading": return <Delayed><p className="muted">{t("voice.loading")}</p></Delayed>;
    case "list": return <VoiceList onOpen={(id) => void host.listVoices().then((l) => openVoice(id, l))} onNew={() => setState({ kind: "new", first: false, names: state.names })} />;
    case "new":
      return (
        <div>
          {!state.first && <button className="back" onClick={() => void start()}>← {t("nav.voices")}</button>}
          <VoiceIntake existing={state.names} onBuild={(name, sources) => void build(name, sources, state.first, state.names)} error={state.error} />
        </div>
      );
    case "building": return <BuildingVoice onCancel={() => void host.cancelVoiceBuild()} />;
    case "rebuilding": return <BuildingVoice relearn onCancel={() => void host.cancelVoiceBuild()} />;
    case "voice":
      return (
        <div className="voice-page">
          {onBackToArticle ? (
            <button className="back" onClick={onBackToArticle}>← {t("nav.backToArticle")}</button>
          ) : state.count > 1 ? (
            <button className="back" onClick={() => setState({ kind: "list", names: state.names })}>← {t("nav.voices")}</button>
          ) : null}
          <VoicePortrait
            voice={state.voice}
            onChange={(voice) => { prime(voiceKey(voice.id), voice); setState({ ...state, voice }); }}
            onDelete={() => void remove(state.voice)}
            onWrite={() => onWrite(state.voice.id)}
          />
          <VoiceSources voice={state.voice} onChange={(voice) => { prime(voiceKey(voice.id), voice); setState({ ...state, voice }); }} onRebuild={() => void rebuild(state)} />
          <p className="voice-foot">
            <button className="link" onClick={() => setState({ kind: "new", first: false, names: state.names })}>{t("voice.another")}</button>
          </p>
        </div>
      );
  }
}
