import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { host, type Article, type ArticleStatus, type Effort, type Platform, type UiError, type VoiceSummary } from "../platform/host";
import { mockScene } from "../platform/mock";
import { asUiError } from "../errors";
import { t } from "../i18n";
import { useAutosave } from "../hooks/useAutosave";
import { ErrorNote } from "./ErrorNote";
import { relativeDate } from "./ArticleList";
import { VersionHistory } from "./VersionHistory";

// Editing snapshots (D-46): every ten minutes of active editing, and when
// the article is closed with changes since the last snapshot.
const SNAPSHOT_MS = 10 * 60 * 1000;

const EFFORT_KEY = "lita.effort";
type Text = { title: string; body: string; brief: string };
type Gen = { kind: "idle" } | { kind: "generating" } | { kind: "done"; notes: string };

// The editor: the text on the left, Lita's help on the right. Everything
// the person types is saved as they go (D-46); Lita writes only when asked,
// and always into the same text, so there is one thing to judge.
export function Editor({ id, onBack, onDeleted, onGoVoices, onAdjustVoice }: { id: string; onBack: () => void; onDeleted: () => void; onGoVoices: () => void; onAdjustVoice: (voiceId: string) => void }) {
  const [article, setArticle] = useState<Article | null>(null);
  const [text, setText] = useState<Text>({ title: "", body: "", brief: "" });
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [voices, setVoices] = useState<VoiceSummary[]>([]);
  const [effort, setEffort] = useState<Effort>(() => { try { return (localStorage.getItem(EFFORT_KEY) as Effort) || "quality"; } catch { return "quality"; } });
  const [gen, setGen] = useState<Gen>({ kind: "idle" });
  const [error, setError] = useState<UiError | null>(null);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [showVersions, setShowVersions] = useState(mockScene() === "editor-versions");
  const lastSnapshot = useRef<{ at: number; text: Text | null }>({ at: Date.now(), text: null });

  const save = useCallback(async (v: Text) => { await host.updateArticle(id, v); }, [id]);
  const same = useCallback((a: Text, b: Text) => a.title === b.title && a.body === b.body && a.brief === b.brief, []);
  const auto = useAutosave<Text>(`lita.unsaved.${id}`, save, same);

  useEffect(() => { try { localStorage.setItem(EFFORT_KEY, effort); } catch {} }, [effort]);
  useEffect(() => { void host.platforms().then(setPlatforms).catch(() => {}); void host.listVoices().then(setVoices).catch(() => {}); }, []);

  // Load, preferring a local copy that failed to save last time.
  useEffect(() => {
    let live = true;
    void host.getArticle(id).then((a) => {
      if (!live) return;
      if (!a) { setError({ code: "invalid_input", detail: "no such article" }); return; }
      setArticle(a);
      const server: Text = { title: a.title, body: a.body, brief: a.brief };
      const local = auto.recover();
      if (local && new Date(a.updated_at).getTime() < local.at && !same(local.value, server)) {
        auto.settle(server);
        setText(local.value);
        auto.update(local.value);
      } else {
        auto.settle(server);
        setText(server);
      }
      if (mockScene() === "editor-generating") setGen({ kind: "generating" });
    }).catch((e) => { if (live) setError(asUiError(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Leaving flushes what is pending, then snapshots if anything changed
  // since the last snapshot (the native side skips identical text).
  useEffect(() => () => {
    void auto.flush().then(() => {
      const last = lastSnapshot.current.text;
      if (last === null || !same(last, textRef.current)) void host.snapshotArticle(id, false).catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const textRef = useRef<Text>(text);
  textRef.current = text;

  // Periodic snapshot while editing.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (auto.state.kind !== "clean") return;
      const last = lastSnapshot.current;
      if (Date.now() - last.at < SNAPSHOT_MS) return;
      if (last.text !== null && same(last.text, textRef.current)) return;
      lastSnapshot.current = { at: Date.now(), text: textRef.current };
      void host.snapshotArticle(id, false).catch(() => {});
    }, 30000);
    return () => window.clearInterval(timer);
  }, [id, auto.state.kind, same]);

  const edit = (patch: Partial<Text>) => {
    setText((prev) => { const next = { ...prev, ...patch }; auto.update(next); return next; });
    setCopied(false);
  };
  const setField = async (patch: { voice_id?: string | null; platform_id?: string; status?: ArticleStatus }) => {
    if (!article) return;
    setArticle({ ...article, ...patch });
    try { await host.updateArticle(id, patch); } catch (e) { setError(asUiError(e)); }
  };

  const platform = platforms.find((p) => p.id === article?.platform_id) ?? null;
  const count = [...text.body].length;
  const over = platform?.max_chars != null && count > platform.max_chars ? count - platform.max_chars : 0;
  // Reading time: Japanese at about 500 characters a minute, English at
  // about 200 words; which one by the share of ASCII letters.
  const readMinutes = useMemo(() => {
    const ascii = (text.body.match(/[A-Za-z]/g) ?? []).length;
    const latin = count > 0 && ascii / count > 0.5;
    const units = latin ? text.body.trim().split(/\s+/).filter(Boolean).length / 200 : count / 500;
    return Math.max(1, Math.round(units));
  }, [count, text.body]);
  const longForm = platform?.max_chars == null;
  const canWrite = !!article?.voice_id && text.brief.trim().length > 0 && gen.kind !== "generating";

  useEffect(() => {
    if (!previewOpen || !article?.voice_id) return;
    let live = true;
    setPreview(null);
    void host.previewPrompt(article.voice_id, text.brief, article.platform_id).then((p) => { if (live) setPreview(p); }).catch(() => {});
    return () => { live = false; };
  }, [previewOpen, article?.voice_id, article?.platform_id, text.brief]);

  const write = useCallback(async (previous?: string) => {
    if (!article) return;
    setError(null);
    await auto.flush();
    setGen({ kind: "generating" });
    try {
      const w = await host.generateIntoArticle(id, effort, previous);
      const next: Text = { title: w.article.title, body: w.article.body, brief: w.article.brief };
      setArticle(w.article);
      auto.settle(next);
      setText(next);
      setCopied(false);
      setGen({ kind: "done", notes: w.voice_notes });
      lastSnapshot.current = { at: Date.now(), text: next };
      bodyRef.current?.focus();
    } catch (e) {
      const err = asUiError(e);
      setGen({ kind: "idle" });
      if (err.code !== "cancelled") setError(err);
    }
  }, [article, id, effort, auto]);

  const copy = async () => {
    try {
      await host.copyText(text.body);
      setCopied(true);
      await setField({ status: "approved" });
    } catch (e) { setError(asUiError(e)); }
  };
  const remove = async () => {
    if (!window.confirm(t("article.deleteConfirm"))) return;
    try { await host.deleteArticle(id); onDeleted(); } catch (e) { setError(asUiError(e)); }
  };
  const onKey = (e: React.KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canWrite) { e.preventDefault(); void write(); } };

  if (!article) return <div className="editor"><p className="muted">{error ? "" : t("article.loading")}</p>{error && <ErrorNote error={error} />}</div>;

  const saveLabel =
    auto.state.kind === "saving" ? t("save.saving")
    : auto.state.kind === "dirty" ? t("save.pending")
    : auto.state.kind === "failed" ? t("save.failed")
    : auto.state.at ? t("save.savedAt", { when: relativeDate(new Date(auto.state.at).toISOString()) }) : "";

  return (
    <div className="editor" onKeyDown={onKey}>
      <div className="editor-bar">
        <button className="back" onClick={onBack}>← {t("nav.articles")}</button>
        <span className="editor-bar-right">
          <span className={auto.state.kind === "failed" ? "save-state warn" : "save-state"} role="status">
            {saveLabel}
            {auto.state.kind === "failed" && <button className="link" onClick={() => void auto.retry()}>{t("save.retry")}</button>}
          </span>
          <button className={showVersions ? "quiet sm on" : "quiet sm"} aria-pressed={showVersions} onClick={() => setShowVersions((v) => !v)}>{t("versions.title")}</button>
        </span>
      </div>

      <div className="editor-grid">
        <div className="paper">
          <input className="title" value={text.title} onChange={(e) => edit({ title: e.target.value })} placeholder={t("editor.titlePlaceholder")} aria-label={t("editor.title")} disabled={gen.kind === "generating"} />
          <textarea ref={bodyRef} className="body" value={text.body} onChange={(e) => edit({ body: e.target.value })} placeholder={t("editor.bodyPlaceholder")} aria-label={t("editor.body")} disabled={gen.kind === "generating"} />
          <div className="paper-foot">
            <span className={over ? "count over" : "count"}>
              {platform?.max_chars != null ? t("write.chars", { n: String(count), max: String(platform.max_chars) }) : t("editor.countRead", { n: String(count), min: String(readMinutes) })}
            </span>
            {over > 0 && <span className="warn small">{t("write.over", { n: String(over) })} <button className="btn sm" onClick={() => void write(text.body)}>{t("write.shorten")}</button></span>}
            <span className="grow" />
            {copied ? <span className="ok small" role="status">✓ {t("write.copied")}</span> : (
              <button className="btn pri sm" disabled={!text.body.trim()} onClick={() => void copy()}>{t("write.copy")}</button>
            )}
          </div>
        </div>

        {showVersions ? (
          <VersionHistory
            article={article}
            current={{ title: text.title, body: text.body }}
            onClose={() => setShowVersions(false)}
            onRestored={(a) => {
              const next: Text = { title: a.title, body: a.body, brief: a.brief };
              setArticle(a); auto.settle(next); setText(next); setCopied(false);
              lastSnapshot.current = { at: Date.now(), text: next };
            }}
          />
        ) : (
        <aside className="assist">
          <h3>{t("assist.title")}</h3>
          <label className="field">
            <span>{t("write.brief")}</span>
            <textarea value={text.brief} onChange={(e) => edit({ brief: e.target.value })} placeholder={t("write.briefPlaceholder")} rows={4} disabled={gen.kind === "generating"} />
          </label>
          <div className="field">
            <div className="field-head">
              <span id="voice-field-label">{t("assist.voice")}</span>
              {/* Straight to the voice this article is written in, and straight back (scene c). */}
              {article.voice_id && <button className="link" onClick={() => onAdjustVoice(article.voice_id!)}>{t("assist.voiceFix")}</button>}
            </div>
            <select aria-labelledby="voice-field-label" value={article.voice_id ?? ""} onChange={(e) => void setField({ voice_id: e.target.value || null })} disabled={gen.kind === "generating"}>
              {!article.voice_id && <option value="">{t("assist.noVoice")}</option>}
              {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <label className="field">
            <span>{t("write.platform")}</span>
            <select value={article.platform_id} onChange={(e) => void setField({ platform_id: e.target.value })} disabled={gen.kind === "generating"}>
              {platforms.map((p) => <option key={p.id} value={p.id}>{p.max_chars != null ? t("write.platformStatic", { name: p.name, max: String(p.max_chars) }) : p.name}</option>)}
            </select>
          </label>
          <div className="field">
            <span>{t("write.effort")}</span>
            <div className="seg" role="tablist">
              {(["fast", "quality"] as Effort[]).map((e) => (
                <button key={e} role="tab" aria-selected={effort === e} className={effort === e ? "on" : ""} onClick={() => setEffort(e)}>{t(e === "fast" ? "effort.fast" : "effort.quality")}</button>
              ))}
            </div>
            <span className="hint inline">{t(longForm ? (effort === "fast" ? "effort.fastHintLong" : "effort.qualityHintLong") : (effort === "fast" ? "effort.fastHint" : "effort.qualityHint"))}</span>
          </div>

          {gen.kind === "generating" ? (
            <div className="generating" role="status">
              <span className="spinner" aria-hidden="true" />
              <div><div>{t("write.generating")}</div></div>
              <button className="btn sm" onClick={() => void host.cancelGenerate()}>{t("write.cancel")}</button>
            </div>
          ) : (
            <div className="assist-actions">
              <button className="btn pri" disabled={!canWrite} onClick={() => void write()}>{text.body.trim() ? t("write.again") : t("write.generate")}</button>
              <span className="hint inline muted">{t("write.shortcut")}</span>
            </div>
          )}
          {!article.voice_id && <p className="hint">{t("assist.needVoice")} <button className="link" onClick={onGoVoices}>{t("article.goVoices")}</button></p>}
          {text.body.trim() && gen.kind !== "generating" && <p className="hint">{t("assist.rewriteHint")}</p>}
          {gen.kind === "done" && gen.notes && <p className="notes"><span className="muted">{t("write.notes")}:</span> {gen.notes}</p>}
          {error && <ErrorNote error={error} />}

          <details className="more" open={previewOpen} onToggle={(e) => setPreviewOpen((e.target as HTMLDetailsElement).open)}>
            <summary>{t("write.preview")}</summary>
            <pre className="prompt">{preview ?? "…"}</pre>
          </details>

          <div className="assist-foot">
            {article.status !== "archived" ? (
              <button className="quiet sm" onClick={() => void setField({ status: "archived" })}>{t("article.archive")}</button>
            ) : (
              <button className="quiet sm" onClick={() => void setField({ status: "draft" })}>{t("article.unarchive")}</button>
            )}
            <button className="quiet sm" onClick={() => void remove()}>{t("article.delete")}</button>
          </div>
        </aside>
        )}
      </div>
    </div>
  );
}
