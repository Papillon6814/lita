# D-79 文体ページの「この文体で書く」を消した報告

- 日付: 2026-09-30（lita-dev）
- ブランチ: `fix/d79-remove-write-with-voice`（最新の main = v0.2.26 から）
- 照らしたもの: D-79（本人、2026-09-30。decisions.md への記録は PM が別ブランチで実施中のため、このブランチでは触っていません）、D-69、`docs/pm/handoff.md` の「残る白紙の道」
- 対応する Issue はありません（委任文で指示なし。`gh issue list` でも該当なし）

## 1．やったこと

**文体ページの「この文体で書く」ボタンと、その先にある白紙の記事を作る道を、画面から Rust のコマンドまで消しました。** 記事を書く入口は、サイドバーの「題から書く」1 つだけになります（D-69、D-79）。

- ボタンと文言キー `voice.write`（ja「この文体で書く」、en「Write with this Voice」）を削除
- ボタンだけが使っていたもの: `VoicePortrait` の `onWrite`、`VoiceSection` の `onWrite`、`Shell` の `newArticle`、CSS の `.cta`（他に使う場所なし）
- 呼ばれなくなったもの: `Host.createArticle`（`types.ts`・`tauri.ts`・`mock.ts`）と Tauri コマンド `create_article`（`invoke_handler` の登録も）

## 2．消したもの・残したもの

| もの | 判断 | 理由 |
| --- | --- | --- |
| `host.createArticle`（TS） | **消した** | 呼び出し元はこのボタンだけだった。D-69 で残した理由は「他の道で使う余地」だったが、D-79 で白紙の記事を作る道を持たないと決まったため、その余地は無くなった。残すと、実機で観察された「既存の空の記事を開く」挙動を持つ道がまた付けられる余地にもなる |
| Tauri コマンド `create_article` | **消した** | `host.createArticle` だけが呼んでいた。空の下書きの再利用（#93）もこのコマンドの中だけの処理 |
| mock の `createArticle` | **消した** | `Host` から消したため。mock のシーンでこれを前提にしたものは無かった（シーン一覧に変更なし） |
| `lita-store` の `Store::create_article` | **残した** | 題から書く（キュー）と note の取り込みが `src-tauri` の中で使っている |
| `lita-store` の `Store::empty_drafts` | **残した（懸念 1）** | アプリからは呼ばれなくなったが、crate の公開 API でテストがある。範囲外の書き直しを避けた |

## 3．触ったファイル

- `src/components/VoicePortrait.tsx`、`src/components/VoiceSection.tsx`、`src/components/Shell.tsx`
- `src/i18n/ja.ts`、`src/i18n/en.ts`（同じキーを両方から削除）
- `src/App.css`（`.cta` の 2 行）
- `src/platform/types.ts`、`src/platform/tauri.ts`、`src/platform/mock.ts`
- `src-tauri/src/lib.rs`（`create_article` コマンドと登録）
- `docs/pm/ux/d79-remove-write-with-voice/impl/*.png`、この報告

## 4．実行したコマンドと結果

- `npx tsc --noEmit -p tsconfig.json` → エラーなし
- `npm run build` → 成功
- `cargo test --workspace` → 161 本すべて通過
- `cargo clippy --workspace --all-targets` → 警告は `lita-codex` の既存 8 件（`voice/pipeline.rs`・`voice/measure.rs`）だけ。`src-tauri` は 0
- `npm run mock` → headless Chrome（1120×900、ja）で 3 シーンを撮影し、目で確認

## 5．撮影（`docs/pm/ux/d79-remove-write-with-voice/impl/`）

| 状態 | シーン | ファイル | 見たこと |
| --- | --- | --- | --- |
| 文体が 0 件 | `intake` | `intake.png` | 文体の作成画面。ボタンは元々無く、変化なし |
| 材料 0 本のおすすめの文体 | `voice-preset` | `voice-preset.png` | 一行の下に D-70 の一文で終わる。ボタンの跡の余白・崩れなし |
| ふつうの文体 | `voice` | `voice.png` | 一行（と「直す」）でカードが終わる。ボタンの跡の余白・崩れなし |

## 6．判定

| 条件 | 判定 |
| --- | --- |
| ボタン・文言キー（ja/en）・ハンドラを消す | ◎ |
| 使われなくなった TS のコード（関数、props、i18n、mock）を消す | ◎ `rg` で `onWrite`・`createArticle`・`voice.write` の残りが無いことを確認 |
| `host.createArticle` と Rust のコマンドの扱いを判断し理由を書く | ◎ 2 節 |
| レイアウトの穴が出ない | ◯ 3 状態で崩れなし。カード下端の余白は懸念 2 |
| build・test・clippy が通る | ◎ |

## 7．懸念

1. `Store::empty_drafts` はアプリから呼ばれなくなりました。消すかは別に判断してください（消すならテスト `articles_queue_and_empty_drafts_sort_all_1205_rows_after_keyset_paging` の該当部分も直します）
2. 文体カードの下端は、一行（`.lead` の下 12px）か D-70 の一文（`.preset-note` の下 12px）で終わり、カード自体の内側の余白が続きます。撮影では穴には見えませんが、下端の余白の釣り合いは lita-ux の判断に任せます（CSS は変えていません）
3. `&lang=en` を付けて撮った画面も日本語のままだったため、英語の撮影は入れていません。英語の文言は削除だけなので、画面への影響はありません
