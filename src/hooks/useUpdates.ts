import { useCallback, useEffect, useState } from "react";
import { host } from "../platform/host";
import { mockScene } from "../platform/mock";
import { asUiError } from "../errors";
import type { UpdateState } from "../components/UpdateDialog";

// Updates (#25): a quiet check at launch that only leaves a small note in
// the sidebar; the dialog opens from the menu ("Lita › アップデートを確認…")
// or from that note. This lives at the top of the app, not in the Shell, so
// the menu works on the sign-in and Codex screens too.
export function useUpdates() {
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
    let gone = false;
    void host.onCheckUpdate(() => void checkUpdate(true)).then((u) => { if (gone) u(); else un = u; });
    return () => { gone = true; un?.(); };
  }, [checkUpdate]);
  useEffect(() => {
    if (mockScene() === "update-downloading" && update?.kind === "available") {
      const info = update.info;
      setUpdate({ kind: "downloading", info, downloaded: 0, total: null });
      void host.installUpdate((e) => { if (e.event === "progress") setUpdate({ kind: "downloading", info, downloaded: e.data.downloaded, total: e.data.content_length }); });
    }
  }, [update]);
  return { update, setUpdate, available, checkUpdate };
}
