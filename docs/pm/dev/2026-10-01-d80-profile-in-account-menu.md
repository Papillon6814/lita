# D-80 プロフィールの切替を左下のアカウントのボタンにまとめた報告

- 日付: 2026-10-01（lita-dev）
- ブランチ: `feat/d80-profile-in-account-menu`（最新の main = v0.2.27 から）
- 照らしたもの: D-80（本人、2026-10-01。decisions.md への記録は PM が別ブランチで実施中のため、このブランチでは触っていません）、D-78（発信プロフィール）、`docs/pm/dev/2026-09-27-publishing-profiles.md`
- Issue: #137（参照のみ。クローズ済み）

## 1．やったこと

**プロフィールの切替を、サイドバー最上部から左下のアカウントのボタンへ移しました。** 最上部の「プロフィール」ラベルと切替器は消しました。

- 左下のボタンを 2 行にしました。上が選択中のプロフィール名（`--fg`、0.9rem）、下がメールアドレス（`--mute`、0.78rem）。プロフィールが 1 つでも名前を出します。どちらも 1 行で省略（…）し、ボタンの高さは名前とメールの長さで変わりません（49.14px のまま。下の「確かめたこと」）
- 頭文字の丸は残し、**メールアドレスの頭文字のまま**にしました（理由は 2 節）
- 押すと上に開くメニューを 1 つにしました。並びは、プロフィール一覧（選択中にチェック）→ 区切り → 「名前を変更…」「新しいプロフィール」→ 区切り → メールアドレス・Codex の状態 →「サインアウト」
- 名前の入力（改名・新規作成）の部品と動きはそのまま移しました。置き場所はボタンのすぐ上で、メニューと同じ位置に、メニューと入れ替わって出ます。名前が空なら作らない、Enter で作成・保存、Escape でメニューに戻る、作成・保存後はメニューに戻って選択中の項目にフォーカス、はそのままです
- 切替の保存待ち、保存に失敗したら切り替えない、切替中はボタンと項目を押せない（`profileBusy`）は変えていません。`Shell.tsx` は触っていません
- 切替・作成・改名の失敗（`profileError`）は、前と同じくメニューとフォームの中に出します。メニューでは、失敗の対象が分かるようにプロフィール一覧の直後に置きました（前はメニューの最後）
- キーボード: メニューを開くと選択中のプロフィールにフォーカス、↑↓ でサインアウトまで含めて循環、Escape で閉じてボタンに戻る
- アクセシビリティ: ボタンは `aria-haspopup="menu"`・`aria-expanded`、メニューは `role="menu"`、プロフィールは `menuitemradio` と `aria-checked`、操作は `menuitem`、区切りに `role="separator"`。ボタンの `aria-label` は、見えている名前を読み上げから落とさないように「アカウント（プロフィール: {name}）」にしました
- mock にシーンを 2 つ足しました: `profiles-menu`（プロフィール 2 つ、メニューを開いた状態）、`profiles-create`（プロフィール 2 つ、新規作成の入力を開いた状態）

## 2．頭文字の判断

**メールアドレスの頭文字（今と同じ「K」）にしました。**

- 既存の見た目を変えない。今のボタンの丸はメールの頭文字で、これを変えないのが最も変化が小さい
- このボタンはアカウントのボタン（サインアウトもここ）で、丸はアカウントを表すと読める。プロフィール名は丸のすぐ右に文字で出るので、丸で重ねて示す必要がない
- プロフィール名の頭文字にすると、「プロフィール 1」は「プ」、「個人発信」は「個」のように切替のたびに丸が変わり、日本語 1 字は 26px の丸では読みにくい

## 3．触ったファイル

- `src/components/Sidebar.tsx`（最上部の切替器を消し、左下のボタンとメニューに統合）
- `src/App.css`（`.profile-picker` `.profile-label` `.profile-trigger*` `.menu.up` を削除。`.profile-menu` を上に開く位置へ。`.acct-text` `.acct-profile` `.profile-menu-name` を追加。新しい色・角丸・書体は足していません）
- `src/i18n/ja.ts`、`src/i18n/en.ts`（`profile.label` を両方から削除、`account.menuWithProfile` を両方に追加。`MessageKey` の union からも `profile.label` を削除）
- `src/platform/mock.ts`（シーンの説明に 2 つ追記）
- `docs/pm/ux/d80-profile-in-account-menu/impl/*.png`、この報告

## 4．実行したコマンドと結果

- `npx tsc --noEmit -p tsconfig.json` → エラーなし
- `npm run build` → 成功
- `cargo test --workspace` → 161 本すべて通過（Rust は触っていません）
- `cargo clippy --workspace --all-targets` → 警告は `lita-codex` の既存 8 件だけ
- `npm run mock` → headless Chrome で撮影。静止画は `--screenshot`、操作が要る画（入力中、長い名前、保存失敗中の切替）は Chrome DevTools Protocol で `click()` と文字入力をしてから撮影（スクリプトはリポジトリ外の作業用ディレクトリ）。英語は `LANG=en_US.UTF-8 LANGUAGE=en` と `--lang=en-US --accept-lang=en-US`、新しい `--user-data-dir`

## 5．確かめたこと（受け入れ条件ごと）

| 条件 | 確かめ方 | 判定 |
|---|---|---|
| 最上部のラベルと切替器が無い | `one-profile.png`、`two-profiles.png` | ◎ |
| 左下が 2 行（名前／薄いメール）、1 つでも名前を出す | `one-profile.png`（1 つ）、`two-profiles.png`（2 つ） | ◎ |
| 長い名前・長いメールは 1 行で省略、高さが変わらない | `long-names.png`。UI で改名した長い名前と、DOM に入れた長いメール。ボタンの高さは前後とも 49.14px | ◎ |
| メニューの並び | `menu-open.png`、`menu-open-en.png` | ◎ |
| 名前の入力（必須・Enter・Escape・戻り先） | `name-form.png`、`name-typing.png`。CDP で、空のまま送信するとフォームのまま・名前は変わらない、「会社広報」で送信すると作成されて選択され、メニューに戻る（一覧に 3 つ、会社広報にチェック）。改名後に Escape でメニューを閉じるとボタンにフォーカスが戻る | ◎ |
| 保存に失敗したら切り替えない | `switch-save-failed.png`（`editor-save-failed-profiles`）。本文を書き足して保存が失敗した状態で「個人発信」を押すと、選択は「プロフィール 1」のまま、メニューも開いたまま、本文の上に「保存できませんでした。この PC には残っています。もう一度保存」 | ◎ |
| 切替が成功すると切り替わる | CDP: 「個人発信」を押すとボタンの名前と `aria-label` が「個人発信」になり、メニューが閉じる | ◎ |
| 英語 | `menu-open-en.png` | ◎ |
| 不要な CSS・i18n キーを消す、ja/en を揃える | `grep -rn "profile.label\|profile-trigger\|profile-picker\|menu.up" src` → 該当なし。tsc（`Record<MessageKey, string>`）が通る | ◎ |

PNG（すべて `docs/pm/ux/d80-profile-in-account-menu/impl/`）: `one-profile.png`、`two-profiles.png`、`menu-open.png`、`name-form.png`、`name-typing.png`、`switch-save-failed.png`、`long-names.png`、`menu-open-en.png`

## 6．懸念

| 懸念 | 内容 |
|---|---|
| 切替・作成・改名そのものの失敗（`profileError`）の画は撮っていない | mock に `selectProfile` などを失敗させる道がないため。表示の場所はメニュー（一覧の直後）とフォームの中で、前と同じ部品（`ErrorNote`）です |
| 切替が成功した直後、フォーカスがボタンに戻らない | `chooseProfile` がボタンにフォーカスを戻す時点で、ボタンはまだ `profileBusy` で押せない状態のため。前の最上部の切替器でも同じ動きで、今回は変えていません |
| 押せない間のボタンを薄くした | 前は左下のボタンに押せない間の見た目がなく、最上部の切替器だけが `opacity: .55` で薄くなっていました。切替器が無くなるので、同じ値を左下のボタンに付けました |
| メニューの幅 | 前の切替メニューと同じ `min(270px, …)` で、サイドバー（220px）より右にはみ出して本文に重なります。前のアカウントのメニュー（240px）も同じくはみ出していました |

## 7．レビュー後の直し（2026-10-01、lita-ux の判定書 `../ux/2026-10-01-d80-profile-in-account-menu-review.md` の 4-1）

**切替が成功したあと、フォーカスを左下のボタンへ戻すようにしました。** 前は成功の時点でボタンがまだ `profileBusy`（押せない状態）で、`focus()` が効かずに `BODY` へ落ちていました。

- `Sidebar.tsx`: 成功したら「ボタンへ戻す」印を立て、`profileBusy` が外れた直後の effect でボタンにフォーカスします。選択中のプロフィールを押したとき（`profileBusy` が立たないとき）も同じ道で戻ります
- メニューと入力欄へのフォーカスを移す effect は、`profileBusy` の間は何もせず、外れてから動くようにしました。押せない項目にはフォーカスが乗らないためです。作成の後は、新しいプロフィールの行にフォーカスが乗ります
- 保存に失敗して切り替わらなかったときの戻り先は変えていません。メニューは開いたままで、フォーカスは選択中（切り替わらなかった元のプロフィール）の行に乗ります。直す前のコードでも同じ行でした（下の確認）。判定書の「押した行に残す（今と同じ）」とは行が違いますが、委任文の「今のままでよい」に従い変えていません

確かめたこと（`npm run mock`、headless Chrome を CDP で操作し `document.activeElement` を読んだ）:

| 操作 | フォーカスの先 | 判定 |
|---|---|---|
| `?scene=profiles-menu` で「個人発信」を押す | `.sidebar .acct`（ボタンは「個人発信」） | ◎（直す前は `BODY`） |
| 続けてメニューを開き、選択中の「個人発信」を押す | `.sidebar .acct` | ◎ |
| 「新しいプロフィール」→「会社広報」で作成 | メニューの「会社広報 ✓」の行（作成後はメニューに戻る、前からの動き） | ◎ |
| 「名前を変更…」→「会社の広報」で保存 | メニューの「会社の広報 ✓」の行 | ◎ |
| `?scene=editor-save-failed-profiles` で本文を書き足し、「個人発信」を押す（保存失敗） | メニューは開いたまま、「プロフィール 1 ✓」の行。直す前のコード（`git stash` で戻して同じ手順）でも同じ | 変更なし |

- `npx tsc --noEmit -p tsconfig.json` → エラーなし、`npm run build` → 成功
