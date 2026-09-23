import { useCallback, useEffect, useRef, useState } from "react";
import { host, type ArticleStatus, type CodexStatus, type SessionStatus } from "../platform/host";
import { mockScene } from "../platform/mock";
import { Sidebar, FILTERS } from "./Sidebar";
import { ArticleList } from "./ArticleList";
import { TopicPicker } from "./TopicPicker";
import { Editor } from "./Editor";
import { VoiceSection } from "./VoiceSection";

// The app is three things (D-44): articles, the editor, and voices. The
// sidebar names the first and last; the editor opens from the list. Where
// the person was is remembered for the session, so a relaunch lands them
// back on the same article.
export type Route =
  | { kind: "articles"; filter: ArticleStatus | "all" }
  | { kind: "article"; id: string }
  // Deciding what to write about: one screen, reached from the list and
  // returning to it (no sidebar entry, D-52).
  | { kind: "topics" }
  // A voice can be opened from an article (the editor's 調整する link); then
  // there is one way back, to that same article.
  | { kind: "voices"; voiceId?: string; backTo?: { kind: "article"; id: string } };

const ROUTE_KEY = "lita.route";

function initialRoute(): Route {
  const scene = mockScene();
  if (scene?.startsWith("topics")) return { kind: "topics" };
  if (scene?.startsWith("editor")) return { kind: "article", id: "a1" };
  if (scene?.startsWith("voice") || scene?.startsWith("intake") || scene === "building") return { kind: "voices" };
  if (scene?.startsWith("articles")) return { kind: "articles", filter: "all" };
  try {
    const raw = sessionStorage.getItem(ROUTE_KEY);
    if (raw) {
      const route = JSON.parse(raw) as Route;
      // A filter that no longer has a sidebar entry falls back to "all".
      if (route.kind === "articles" && !FILTERS.includes(route.filter)) return { kind: "articles", filter: "all" };
      return route;
    }
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

  // Anything left waiting from last time goes on quietly, once, as soon as
  // there is a session to write with (no confirmation, no resume button).
  const started = useRef(false);
  useEffect(() => {
    if (started.current || session?.status !== "signed_in") return;
    started.current = true;
    void host.startQueue().catch(() => {});
  }, [session]);


  // A new article starts with the voice used last (D-55: there is no
  // "default" voice); with a single voice, that one.
  const newArticle = useCallback(async (voiceId?: string) => {
    let id = voiceId;
    if (!id) {
      try {
        const recent = await host.listArticles();
        id = recent.find((a) => a.voice_id)?.voice_id ?? undefined;
        if (!id) { const voices = await host.listVoices(); if (voices.length === 1) id = voices[0].id; }
      } catch {}
    }
    const a = await host.createArticle(undefined, id);
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
          <ArticleList
            filter={route.filter}
            onOpen={(id) => setRoute({ kind: "article", id })}
            onNew={() => void newArticle()}
            onGoVoices={() => setRoute({ kind: "voices" })}
            onGoTopics={() => setRoute({ kind: "topics" })}
            onShowCodexSteps={onShowCodexSteps}
          />
        )}
        {route.kind === "topics" && (
          <TopicPicker
            onBack={() => setRoute({ kind: "articles", filter: "all" })}
            onQueued={() => setRoute({ kind: "articles", filter: "all" })}
            onGoVoices={() => setRoute({ kind: "voices" })}
          />
        )}
        {route.kind === "article" && (
          <Editor
            key={route.id}
            id={route.id}
            onBack={() => setRoute({ kind: "articles", filter: "all" })}
            onDeleted={() => setRoute({ kind: "articles", filter: "all" })}
            onGoVoices={() => setRoute({ kind: "voices" })}
            onAdjustVoice={(voiceId) => setRoute({ kind: "voices", voiceId, backTo: { kind: "article", id: route.id } })}
          />
        )}
        {route.kind === "voices" && (
          <VoiceSection
            onWrite={(voiceId) => void newArticle(voiceId)}
            voiceId={route.voiceId}
            onBackToArticle={route.backTo ? () => setRoute(route.backTo!) : undefined}
          />
        )}
      </main>
    </div>
  );
}
