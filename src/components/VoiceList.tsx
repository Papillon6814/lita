import { useEffect, useState } from "react";
import { host, type UiError, type Voice, type VoiceSummary } from "../platform/host";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { leadSentence } from "../summary";
import { ErrorNote } from "./ErrorNote";
import { relativeDate } from "./ArticleList";

type Props = { onOpen: (id: string) => void; onNew: () => void };

// All the voices, the default first. Each row carries Lita's one sentence
// about that writing, so the list reads like a cast, not a table.
export function VoiceList({ onOpen, onNew }: Props) {
  const [rows, setRows] = useState<VoiceSummary[] | null>(null);
  const [full, setFull] = useState<Record<string, Voice>>({});
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [error, setError] = useState<UiError | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([host.listVoices(), host.getSettings()]).then(async ([list, settings]) => {
      if (!live) return;
      setRows(list);
      setDefaultId(settings.default_voice_id);
      const loaded = await Promise.all(list.map((v) => host.getVoice(v.id)));
      if (live) setFull(Object.fromEntries(loaded.filter((v): v is Voice => !!v).map((v) => [v.id, v])));
    }).catch((e) => { if (live) setError(asUiError(e)); });
    return () => { live = false; };
  }, []);

  const makeDefault = async (id: string) => {
    try { await host.setDefaultVoice(id); setDefaultId(id); } catch (e) { setError(asUiError(e)); }
  };

  const ordered = rows ? [...rows].sort((a, b) => (a.id === defaultId ? -1 : b.id === defaultId ? 1 : 0)) : [];

  return (
    <div className="voices-page">
      <div className="page-head">
        <h2>{t("nav.voices")}</h2>
        <button className="btn sm" onClick={onNew}>{t("voice.list.new")}</button>
      </div>
      <p className="sub">{t("voice.list.lead")}</p>
      {error && <ErrorNote error={error} />}
      {rows === null && <p className="muted">{t("voice.loading")}</p>}
      {rows && (
        <ul className="voice-rows">
          {ordered.map((v) => {
            const f = full[v.id];
            return (
              <li key={v.id} className="voice-row">
                <button className="voice-open" onClick={() => onOpen(v.id)}>
                  <span className="mono sm" aria-hidden="true">{[...v.name][0]?.toUpperCase() ?? "V"}</span>
                  <span className="voice-text">
                    <span className="voice-name">{v.name}{v.id === defaultId && <span className="badge">{t("voice.default")}</span>}</span>
                    <span className="voice-line">{f ? (f.profile.one_line.trim() || leadSentence(f.profile)) : "…"}</span>
                    <span className="voice-meta">{t("voice.list.meta", { n: String(v.source_count), when: relativeDate(v.updated_at) })}</span>
                  </span>
                </button>
                {v.id !== defaultId && <button className="quiet sm" onClick={() => void makeDefault(v.id)}>{t("voice.makeDefault")}</button>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
