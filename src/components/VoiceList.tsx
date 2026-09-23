import { useCallback } from "react";
import { host, type Voice, type VoiceSummary } from "../platform/host";
import { useQuietLoad, prime, voiceKey, VOICES_KEY } from "../hooks/useQuietLoad";
import { t } from "../i18n";
import { leadSentence } from "../summary";
import { ErrorNote } from "./ErrorNote";
import { relativeDate } from "./ArticleList";

type Props = { onOpen: (id: string) => void; onNew: () => void };

// All the voices, most recently touched first. Each row carries Lita's one
// sentence about that writing, so the list reads like a cast, not a table.
export function VoiceList({ onOpen, onNew }: Props) {
  // Names and their one sentence arrive together, so no row is ever drawn
  // twice; coming back to the list paints the remembered rows at once.
  const q = useQuietLoad<{ rows: VoiceSummary[]; full: Record<string, Voice> }>(
    "voiceRows",
    useCallback(async () => {
      const list = await host.listVoices();
      prime(VOICES_KEY, list);
      const loaded = await Promise.all(list.map((v) => host.getVoice(v.id)));
      for (const v of loaded) if (v) prime(voiceKey(v.id), v);
      return {
        rows: [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
        full: Object.fromEntries(loaded.filter((v): v is Voice => !!v).map((v) => [v.id, v])),
      };
    }, []),
  );
  const rows = q.value?.rows ?? null;
  const full = q.value?.full ?? {};
  const error = q.error;

  return (
    <div className="voices-page">
      <div className="page-head">
        <h2>{t("nav.voices")}</h2>
        <button className="btn sm" onClick={onNew}>{t("voice.list.new")}</button>
      </div>
      {error && <ErrorNote error={error} />}
      {q.slow && <p className="muted">{t("voice.loading")}</p>}
      {rows && (
        <ul className="voice-rows">
          {rows.map((v) => {
            const f = full[v.id];
            return (
              <li key={v.id} className="voice-row">
                <button className="voice-open" onClick={() => onOpen(v.id)}>
                  <span className="mono sm" aria-hidden="true">{[...v.name][0]?.toUpperCase() ?? "V"}</span>
                  <span className="voice-text">
                    <span className="voice-name">{v.name}</span>
                    <span className="voice-line">{f ? (f.profile.one_line.trim() || leadSentence(f.profile)) : "…"}</span>
                    <span className="voice-meta">{t("voice.list.meta", { n: String(v.source_count), when: relativeDate(v.updated_at) })}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
