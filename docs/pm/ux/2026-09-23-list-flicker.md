# 一覧のちらつきを消す（Issue #90）

本人の一言（2026-09-23）: 「すべての記事、とかのページを表示するときの loading ちらつきが気になります」。
原則 2「正常時は静か」に戻す作業。要件は増やしていない。

## 原因

1. **毎回まっさらにしていた。** `ArticleList` は filter が変わるたびに `state = loading` にし、「読み込んでいます…」を出してからサーバ（Supabase、数百 ms）の答えで描き直していた。`VoiceList`（`rows === null`）、`VoiceSection`（`kind: "loading"`）、`Editor`（`!article`）も同じ。
2. **速いときにも一文を出していた。** 200 ms で返っても一文が一瞬見える。見えるだけで、読めない。
3. **見出し行が後から動いていた。** 検索欄は取得後、「題を出す」は文体の取得後に現れるので、行の中身が二段階で増えた。
4. **空だと早合点していた。** 取得前の 0 件を「記事がありません」と読み、空の画面が一瞬出てから一覧に変わることがあった。

## 直し方

共通の置き場を一つ作った（`src/hooks/useQuietLoad.ts`）。規則は二つだけ。

- **前の内容の上で取り直す。** 最後に取れた行をモジュール内に覚えておき、同じ画面に戻ったら即座に描く。裏で取り直し、届いたら静かに差し替える。初回だけ何も無い。
- **一文は 300 ms 待つ。** 出すのは「見せる内容が無い」かつ「300 ms を超えた」ときだけ。速く返れば一切出さない（`Delayed` も同じ 300 ms を使う）。

加えて:

- 見出し行の検索欄と「題を出す」は最初から場所を取る（`.hidden-keep` は `visibility: hidden`、`tabIndex={-1}`）。取得の結果で行の高さが変わらない。
- 「記事がありません」「文体がありません」は `settled`（取得が済んだ）まで判断しない。
- 「すべての記事」→「下書き」の移動は、広いほうの行を status で絞って種にするので、こちらも白くならない。
- 文体の追加・削除・作り直しの後はキャッシュを捨て直す（古い一覧を見せない）。

`Editor` だけは覚えた本文を先に描かない。取得中に打った字を、後から届いたサーバの本文が上書きしうるため。一文を遅らせるだけにした（速い記事は、何も言わずに紙が出る）。

## 手数

クリック数は前後とも変わらない（0）。減ったのは「画面が落ち着くまで待つ」時間で、一覧に戻るときの白い間が 1 回から 0 回になる。

## 触ったファイル

- 追加: `src/hooks/useQuietLoad.ts`、`src/components/Delayed.tsx`
- 変更: `src/components/ArticleList.tsx`、`VoiceList.tsx`、`VoiceSection.tsx`、`Editor.tsx`、`src/App.css`（`.hidden-keep` 1 行）、`src/platform/mock.ts`（`?delay=<ms>`）
- 触っていない: `src/platform/types.ts`、`tauri.ts`、Rust、文言（ja/en とも増減なし）

## 確かめ方と結果

`npm run mock` に `?delay=<ms>` を足した。headless Chrome の `--virtual-time-budget` で「何 ms 時点の画」かを決めて撮っている。

| 画 | 条件 | 結果 |
| --- | --- | --- |
| `list-flicker/articles-fast.png` | 遅延なし・150 ms 時点 | 行が出ている。一文は出ない |
| `list-flicker/articles-slow-150.png` | 800 ms 遅延・150 ms 時点 | 白い本文。一文は出ない。見出し行は完成形 |
| `list-flicker/articles-slow-500.png` | 800 ms 遅延・500 ms 時点 | 「読み込んでいます…」が出る |
| `list-flicker/articles-slow-done.png` | 800 ms 遅延・2000 ms 時点 | 一覧に差し替わる |
| `list-flicker/voices-slow-150.png` / `-500.png` / `voices-done.png` | 同上（文体一覧） | 同じ順に、無言 → 一文 → 一覧 |
| `list-flicker/editor-slow-150.png` / `-500.png` | 同上（記事を開く） | 同じ |
| `list-flicker/articles-empty.png`、`check-first-run.png` | 空・文体なし | 見出し行の高さは一覧時と同じ |
| `list-flicker/check-queued.png`、`check-voice.png`、`check-editor.png` | 通常の画面 | 変わっていない |

`npx tsc --noEmit -p tsconfig.json` と `npm run build` は通る。

## 残る懸念

- **filter の移動は目で見ていない。** 「すべての記事」→「下書き」の種入れは、静止画では撮れないのでコードの読みで確かめた。実機で一度確かめたい。
- **覚えた行が古いまま見えうる。** 取り直しが失敗したとき、前の行が残ってエラーの一文が上に出る。消すより残すほうが害が小さいと判断したが、長く失敗が続く場合の見せ方は決めていない。
- **300 ms は仮。** 手元の Supabase は 200〜400 ms で、境目に近い。実機で一文がちらつくようなら 500 ms に上げる。
- **`Editor` は覚えを使っていない。** 打ちかけの字を守るため。記事本文のキャッシュを入れるなら、編集済みかどうかの印が要る。
