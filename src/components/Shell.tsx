import { useCallback, useEffect, useState } from "react";
import { host, type ArticleStatus, type CodexStatus, type SessionStatus } from "../platform/host";
import { mockScene } from "../platform/mock";
import { t } from "../i18n";
import { Sidebar } from "./Sidebar";
import { ArticleList } from "./ArticleList";
import { Editor } from "./Editor";
import { VoiceSection } from "./VoiceSection";
import { UpdateDialog, type UpdateState } from "./UpdateDialog";
import { asUiError } from "../errors";

// The app is three things (D-44): articles, the editor, and voices. The
// sidebar names the first and last; the editor opens from the list. Where
// the person was is remembered for the session, so a relaunch lands them
// back on the same article.
export type Route =
  | { kind: "articles"; filter: ArticleStatus | "all" }
  | { kind: "article"; id: string }
  | { kind: "voices" };

const ROUTE_KEY = "lita.route";

function initialRoute(): Route {
  const scene = mockScene();
  if (scene?.startsWith("editor")) return { kind: "article", id: "a1" };
  if (scene?.startsWith("voice") || scene?.startsWith("intake") || scene === "building") return { kind: "voices" };
  if (scene?.startsWith("articles")) return { kind: "articles", filter: "all" };
  try {
    const raw = sessionStorage.getItem(ROUTE_KEY);
    if (raw) return JSON.parse(raw) as Route;
  } catch {}
  return { kind: "articles", filter: "all" };
}

type Props = {
  session: SessionStatus | null;
  codex: CodexStatus | null;
  codexChecking: boolean;
  onSignOut: () => void;
  onShowCodexSteps: () => void;
};

export function Shell({ session, codex, codexChecking, onSignOut, onShowCodexSteps }: Props) {
  const [route, setRoute] = useState<Route>(initialRoute);
  useEffect(() => { try { sessionStorage.setItem(ROUTE_KEY, JSON.stringify(route)); } catch {} }, [route]);

  // Updates (#25): a quiet check at launch that only leaves a small note in
  // the sidebar; the dialog opens from the menu or from that note.
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [available, setAvailable] = useState<string | null>(null);
  const checkUpdate = useCallback(async (interactive: boolean) => {
    if (interactive) setUpdate({ kind: "checking" });
    try {
      const info = await host.fetchUpdate();
      if (info) { setAvailable(info.version); if (interactive) setUpdate({ kind: "available", info }); }
      else if (interactive) setUpdate({ kind: "latest", version: await host.appVersion() });
    } catch (e) {
      if (interactive) setUpdate({ kind: "error", error: asUiError(e) });
    }
  }, []);
  useEffect(() => {
    const scene = mockScene();
    if (scene?.startsWith("update")) { void checkUpdate(true); return; }
    void checkUpdate(false);
    let un: (() => void) | undefined;
    void host.onCheckUpdate(() => void checkUpdate(true)).then((u) => (un = u));
    return () => un?.();
  }, [checkUpdate]);
  useEffect(() => {
    if (mockScene() === "update-downloading" && update?.kind === "available") {
      const info = update.info;
      setUpdate({ kind: "downloading", info, downloaded: 0, total: null });
      void host.installUpdate((e) => { if (e.event === "progress") setUpdate({ kind: "downloading", info, downloaded: e.data.downloaded, total: e.data.content_length }); });
    }
  }, [update]);

  const newArticle = useCallback(async (voiceId?: string) => {
    const a = await host.createArticle(undefined, voiceId);
    setRoute({ kind: "article", id: a.id });
  }, []);

  return (
    <div className="frame">
      <Sidebar
        route={route}
        onRoute={setRoute}
        onNew={() => void newArticle()}
        session={session}
        codex={codex}
        codexChecking={codexChecking}
        onSignOut={onSignOut}
        onShowCodexSteps={onShowCodexSteps}
        updateAvailable={available}
        onUpdate={() => void checkUpdate(true)}
      />
      {update && <UpdateDialog state={update} onState={setUpdate} onClose={() => setUpdate(null)} />}
      <main className="main">
        {route.kind === "articles" && (
          <ArticleList filter={route.filter} onOpen={(id) => setRoute({ kind: "article", id })} onNew={() => void newArticle()} onGoVoices={() => setRoute({ kind: "voices" })} />
        )}
        {route.kind === "article" && (
          <Editor key={route.id} id={route.id} onBack={() => setRoute({ kind: "articles", filter: "all" })} onDeleted={() => setRoute({ kind: "articles", filter: "all" })} onGoVoices={() => setRoute({ kind: "voices" })} />
        )}
        {route.kind === "voices" && <VoiceSection onWrite={(voiceId) => void newArticle(voiceId)} />}
        <footer className="privacy">{t("privacy.note")}</footer>
      </main>
    </div>
  );
}
