import { useCallback, useEffect, useState } from "react";
import { host, type ArticleStatus, type CodexStatus, type SessionStatus } from "../platform/host";
import { mockScene } from "../platform/mock";
import { t } from "../i18n";
import { Sidebar } from "./Sidebar";
import { ArticleList } from "./ArticleList";
import { Editor } from "./Editor";
import { VoiceSection } from "./VoiceSection";

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
  updateAvailable: string | null;
  onUpdate: () => void;
};

export function Shell({ session, codex, codexChecking, onSignOut, onShowCodexSteps, updateAvailable, onUpdate }: Props) {
  const [route, setRoute] = useState<Route>(initialRoute);
  useEffect(() => { try { sessionStorage.setItem(ROUTE_KEY, JSON.stringify(route)); } catch {} }, [route]);


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
        updateAvailable={updateAvailable}
        onUpdate={onUpdate}
      />
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
