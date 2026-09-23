# 引き継ぎメモ

> 次のセッションはここを読めば再開できます。

**最終更新**: 2026-09-23（v0.2 の 3 柱を段階 1〜6 まで実装）

## 前回やったこと

1. 逆質問で Lita の方向性を確定（広報発信向け・AI が書く前提・文体プロファイルが中核）
2. 技術選定を確定（Tauri v2 / Codex CLI サブプロセス / SQLite / MIT / 英語 UI）
3. リポジトリを初期化して public + MIT で公開、PM エージェントと状態ファイルの運用を敷いた
4. Notion に仕様ページを作成（正）
5. **Codex 呼び出しの PoC を通した**（Issue #1 / PR #2）— 前提は成立。制約を3つ発見
6. **Slack の権限要件を検証した**（Issue #4 / PR #5）— Slack 側はほぼ塞がっていた。同時に **Voice は4件で安定する**ことを実測し、**v0.1 から Slack を外す判断に至った（D-20）**
7. **待ち時間を測り直した**（Issue #3）— **問題設定が誤っていた**。短文生成は6.6秒まで落ちる。生成中はインジケータのみ、推論量はユーザーが選べる形に決定（D-23〜D-26）。`Effort` と `--ignore-user-config` をラッパーに実装済み
8. **Voice スキーマを確定した**（Issue #7）— 部分集合4通り×3回の実測で、**引用を生成に渡すと構造化フィールドが無視され、過去の文が借用される**と判明。引用は保存のみ、生成には構造化フィールド11個だけを渡す（D-27〜D-30）。`voice.rs` に型として固定
9. **Tauri アプリの骨格を立てた**（Issue #9）— React + TS + Vite、`codex_status` コマンドで Codex の状態を表示。en/ja の i18n と `src/platform` 境界を敷設（D-31〜D-35）
10. **バックログ全 15 件を GitHub Issue 化した**（#11〜#25）
11. **保存方式をサーバへ転換した**。SQLite 実装（#11）の途中で「別 PC でも引き継ぎたい」要件が出て、オンライン専用・Google OAuth・v0.1 に含める、と決定（D-36〜D-39）。基盤候補 18 件を調査して Notion 子ページにまとめた。同日 **Supabase に決定（D-40）**
12. **Supabase にスキーマを適用し、Google ログインを実機で通し、API クライアント `lita-store` を作り、アプリ内サインインまで通した**（PR #27〜#31）。Google はデスクトップ用クライアントでもシークレットを要求すると確定し、Supabase 経由の OAuth に切り替えた（D-41）。`crates/lita-auth` がログインとリフレッシュを担う
13. **貼り付け UI と note / Medium / X の取り込みを入れた**（PR #34、#35）
14. **UI/UX を作り直した**（PR #36）。4つのレビュースキルで批評 → Notion の「UI/UX レビュー」ページ → HTML モックで方向を4案 → 絞り込み → ハイエンド UX 批評を全反映、の順で見本を確定し、その通りに実装。見本は Claude Artifact（https://claude.ai/artifact/7m4i2ZmhNvQ1oMcZeJ1Mia）
15. **書く画面を入れた**（#13 / #14 / #16）。ブリーフ → 出す先と考える量 → 「Codex に送る内容をそのまま見る」 → 書く（中止可） → 下書きを直して「コピーして採用」。ブリーフと下書きはサーバに保存し、採用／破棄の状態を持つ。**v0.1 の完成定義の一周が通った**（本人確認済み）。
16. **実装後の UX 再レビュー（#38）**。ブラウザ用モックで全 15 場面を撮り、8 件を指摘して全部反映（`docs/pm/2026-09-22-ux-rereview.md`）。下書きを最上部に、コピー後の状態、⌘⏎、戻るで中止、など
17. **Codex エラーの実地再現（#17）**。未ログインを空の `CODEX_HOME` で再現。`codex login status` の終了コードで事前に弾き、失敗時は `turn.failed` イベントの message で判定するよう変更（`docs/pm/2026-09-22-codex-errors.md`）。`cargo run -p lita-codex --example nologin` で枠を使わず再現できる
18. **Voice の一文（#39）**。`VoiceProfile.one_line` を追加して Codex に書かせ、古い Voice はテンプレートで代用（`docs/pm/2026-09-22-voice-lead.md`）。`cargo run -p lita-codex --example one_line` で 1 回分の枠を使って確認できる
19. **#40 / #41**。上限超えのときに「短く書き直す」（前の下書きを添えた `shorten_prompt`、プレビューも同じ関数を通る）。ブリーフは Voice ごとに sessionStorage で保持し、戻っても消えない
20. **Google 同意画面を本番化した**。必須だったホームページとプライバシーポリシーを `site/` に書いて GitHub Pages（lita.muumoo.online）で公開し、DNS と Google 側の入力はブラウザ操作エージェントと本人で分担（承認済みドメイン欄の入力は権限判定が拒否したため本人が入力）
21. **README を実態に合わせ、アプリアイコン（紙色のタイルにインクの L とミントの点、`design/app-icon.html`）を入れ、リリースビルドを `/Applications/Lita.app` に置いた**（2026-09-23）
22. **v0.2 段階 1: 記事と版のスキーマ**（#49）。`articles` / `article_versions` / `user_settings` を追加し、`briefs` / `drafts` を移行して drop（D-45）。`lita-store` に記事・版・設定の API、Tauri に `list_articles` … `restore_version` … `set_default_voice`。v0.1 の書く画面は互換コマンド（`generate_draft` が記事を作る）で動き続ける。roundtrip で本番検証済み
23. **v0.2 段階 2: Shell・記事一覧・エディタ**。サイドバー（記事: すべて／下書き／採用／保管、文体）＋メイン。ホームは記事一覧（検索、出す先・状態・Voice・更新）。エディタは左に紙（タイトル・本文・文字数・コピーして採用）、右に「Lita に書かせる」（ブリーフ・Voice・出す先・考える量・書く／書き直す／短く・プロンプト確認・保管・削除）。自動保存は `src/hooks/useAutosave.ts`（D-46）。書く画面（WriteScreen）は廃止。窓の既定は 1120×720。モックの scene: articles / articles-empty / editor / editor-empty / editor-generating / editor-over / editor-save-failed
24. **v0.2 段階 3: 版履歴**。エディタ右上の「版履歴」で右パネルが一覧に切り替わる（種類・時刻・いまの本文の印）。選ぶとプレビュー、「この版に戻す」は確認のうえ復元（元の本文は版に残る）。「いまの状態を版として残す」。自動 snapshot は編集中 10 分ごと（30 秒間隔で判定）と閉じるとき
25. **v0.2 段階 4: 長文生成**。出す先に上限が無いとき（note / Medium）は `generation_prompt` が「記事」を求める: `title` を別に返し、段落は空行区切り、見出しは「## 」を要所だけ、長さはブリーフに従い既定は読了 4〜6 分。実機 1 回（note、丁寧に）で見出し付きの記事が返った（`cargo run -p lita-codex --example longform`）。エディタは note / Medium で「文字数・読了 n 分ほど」を出し、考える量のヒントも長文用に変わる
26. **Codex の設定ファイル破損を未ログインと誤判定していたのを修正**。`~/.codex/config.toml` の重複キー（一時的に発生）で `codex doctor` が auth を報告せず、`login status` も exit 1 になり、アプリが「ログインしていません」と出ていた。`Preflight::ConfigBroken`（`config.load` の失敗を見る）と、`logged_in()` は「Not logged in」の文言があるときだけ false、に変更。UI は「設定ファイルを読み込めません」＋ `codex doctor` の案内。**2026-09-23 追記**: `config.load` の status が `warning`（非推奨設定 `analytics_enabled` が 1 つある、設定自体は読めている）でも「壊れている」と誤判定していた。`error` か `config.toml parse != ok` のときだけ壊れている扱いに変更（`interpret_doctor` に切り出しテスト追加）。同時に、更新チェックとダイアログを Shell から App（`hooks/useUpdates.ts`）へ移し、サインイン画面や Codex 案内画面でもメニューの「アップデートを確認…」が効くようにした（この画面で止まっていたためメニューが無反応だった）
27. **v0.2 段階 5: 文体**。「文体」は Voice 一覧（既定が先頭、各行に一文）→ Voice 画面（人物紹介＋詳細＋**試し書き**）。試し書きは記事にせず `trial_write` で 1 本書き、詳細を直してもう一度書くと「前／今」を横並び。「既定にする」、最初の Voice は自動で既定。「作り直す」は「この Voice を削除」に（記事は残り、Voice の指定だけ外れる）
28. **v0.2 段階 6: UX 再レビュー**。全 19 場面を撮って 3 件を直した（初回の導線、Voice 未選択のリンク、取り込みバーの余白）。記録は `docs/pm/2026-09-23-v02-review.md`

## いま決まっていること

v0.1 の入口は **本人の公開済みの発信（note → Medium → X アーカイブ）を取り込むこと**で、貼り付けはその受け皿です（D-43）。**Slack は凍結**しました（D-42。Marketplace 掲載の前提条件が個人 OSS では満たせない）。

データは **サーバが正、オンライン専用** です（D-36）。ログインは Google OAuth（D-37）。基盤は **Supabase（東京）** です（D-40）。

## 次の一手（この順で）

0. **v0.2 の 3 柱（#49、D-44〜D-46）を段階ごとに進める**: 1 スキーマ・ストア・コマンド（完了）→ 2 Shell＋記事一覧＋エディタ（自動保存）（完了）→ 3 版履歴（完了）→ 4 長文生成（完了）→ 5 Voice 複数・試し書き比較（完了）→ 6 モックで UX 再レビュー（完了）。**v0.2 の実装は一通り揃った。次は本人のドッグフーディングと配布（#25）**。計画は `~/.claude-profiles/personal/config/plans/shimmering-exploring-anchor.md`
0. **記事をまとめて生成する（D-61、#87）— 2026-09-23 完了**（要件 `requirements/2026-09-23-article-queue.md`、UX の A/B と実装記録 `ux/2026-09-23-article-queue.md`、試行 `poc/article-queue/trial.md`）。記事一覧の「題を出す」→ 場面「書く題を決める」（`TopicPicker.tsx`: 編集方針 4 行をその場で直す・「叩き台を作る」・今回の方向・10 題のチェック行・文体と出す先・「n 本を積む」）。積むと記事一覧に題つきの下書きが並び、行に「書いています／順番待ち／書けませんでした」の印と「止める／やめる」、上に「n 本を積みました。まとめてやめる」。Rust: `lita_codex::topics`（`topics_prompt`／`policy_prompt`／`brief_for`／`dedupe`）、コマンド `get_policy` `set_policy` `draft_policy` `suggest_topics` `enqueue_articles` `start_queue` `dequeue_article` `clear_queue`、ワーカー `run_queue`（1 本ずつ、`preflight` で Codex の問題は全体停止、`stops_the_queue` の code で判定、閉じて開いたら `writing` を `waiting` に戻して続く）。イベント `queue-event {kind: changed|stopped}`。DB: `articles.queue`、`user_settings.policy jsonb`（migration `20260923200000_article_queue.sql`、本番適用済み）。**未検証**: 実機でのキュー進行（モックでは通る）。出す先の既定は長文の先（X なら note に寄せる）
0. **手で入れる道とつなぐ道の分離（D-60）— 2026-09-23 完了**（要件 `requirements/2026-09-23-manual-intake.md`、UX の A/B と実装記録 `ux/2026-09-23-manual-intake.md`）。新部品 `PasteBox.tsx`（常時開いた欄・空行で分割・「n 本として読みます／1 本にまとめる」・1 本 1 行の一覧に 直す／外す／前とつなげる・.txt/.md のドラッグ＆ドロップ）。`SourceBox` はつなぐ側だけに。Rust は `remove_voice_source`（1 本だけ外す）。**注意**: `tauri.conf.json` に `dragDropEnabled: false`（HTML5 のドロップを WebView に通すため）。実機でのファイル落下は未検証
0. **「つなぐ」中のローディング — 2026-09-23 完了**（要件 `requirements/2026-09-23-connect-loading.md`、UX 記録は `ux/2026-09-23-voice-feature.md` の「つなぐ中のローディング」）。Rust の `import-progress` イベント（note は一覧の後と 1 本ごとに done／total、Medium は不定）を行の中で「回るしるし＋記事を読んでいます（n／m 本）」に。最短 600ms、行は畳めない、他の行は使える
0. **文体の読み取りの厳密化（D-59）— 2026-09-23 完了**。`crates/lita-codex/src/voice/{measure,pipeline,stoplist}.rs`。**生成の契約は従来の 11 項目のまま**（多段の抽出は伏せた比較で 4 連敗したので外した。`2026-09-23-voice-quality-poc.md`）。足したのは: Rust の計測、Rust が材料から探す根拠の引用、反例探しの自己点検（1 回）、確度（高・中・低）。`VoiceProfile` の新フィールド（`measured`・`backing` ほか）はすべて default で、古い文体は同じプロンプト。進捗は「材料を整えています → 文体にまとめています → 材料と照らして見直しています → 保存」。画面は各行の「根拠」リンクと確度「低」の一文（lita-ux）。**次**: 本人の本物の材料（本番の文体は 127 字の貼り付け 4 本しかない）で作り直し、根拠の見え方を確かめる。「合う」の割合は記録のみ
0. **文体機能の作り直し（D-58）— 2026-09-23 完了**。本人の「全然アカン」「何をすればいいか分からない」「文字が多い」「AI の文章のスタイルが調整できると理解できるといい」を受けて、要件責任者が機能全体の要件書 `docs/pm/requirements/2026-09-23-voice-feature.md`（必須 15）、UX 責任者が A/B/C の静的 HTML 3 案（`design/voice-a〜c.html`、比較は `docs/pm/ux/2026-09-23-voice-feature.md`）→ 本人が A（スタイル先行）を選択 → UX 責任者が実装（受け入れ 7/7、`docs/pm/ux/voice-feature/impl-*.png`）。入口は「Lita の書き方を決める」＋空の 8 項目＋材料の行＋「文体を作る」。文体ページは 8 項目を畳まず、「学習ソース」は「元にした文章」に改名。エディタの文体の隣に「調整する」（戻ると同じ記事）。見本文は backlog
0. **学習ソースの行を「どれか一つで足りる」に — 2026-09-23 完了**。本人の一言「もっと任意感を強くしたい」を新設の流れで処理した最初の案件: `lita-requirements` の要件書 `docs/pm/requirements/2026-09-23-sources-optional.md`（必須 10、残る質問 1 は既定値）→ `lita-ux` の設計・実装・再判定 `docs/pm/ux/2026-09-23-sources-optional.md`（受け入れ 7/7）。未連携の行は「▸ 名前＋一行」に畳んで押すと開く、つないだ行が最も重い、リードで「どれか一つつなぐだけで足ります」
0. **文体の学習ソース（#68、D-57）— 2026-09-23 完了**。文体ページに「学習ソース」: 連携先ごとに件数・「新しい記事を取り込む」（origin URL で重複除外）・「外す」、「追加する」で取り込み部品（`SourceBox.tsx`、取り込み画面と共通）、「この材料で学び直す」（`rebuild_voice`、確認あり）。DB は `voice_sources.account`（migration `20260923100000_source_accounts.sql`、本番適用済み）。取り込み画面は本人の指摘（「UI はこのまま？」）を受けて、タブをやめ **連携先を行で並べる**形に（note／Medium／X／手作業が最初から全部見え、つなぐと「✓ note・kuno 10 件 外す」の行に変わる）。同じ部品を文体ページの学習ソースでも使う
0. **文体機能の UX 簡素化 — 2026-09-23 完了（#65、D-53〜D-56）**。UX レビュー `docs/pm/2026-09-23-voice-ux-review.md` の ①〜⑧ を実装: 文言を「文体」に統一、試し書きと既定の文体を廃止、文体ページを読むページに（「…」メニュー、一文のその場編集、詳細 3 群 8 行）、取り込みを一本道に（`n 件の文章を使います・見直す`、名前は出所から自動「note・kuno」「貼った文章」）、1 つなら一覧を飛ばす、プライバシー注記は取り込みと作成中だけ。`trial_write` / `get_settings` / `set_default_voice` コマンドは削除
1. **本人のドッグフーディング（2026-09-23 開始）** — `/Applications/Lita.app`（v0.2.2、GitHub Releases の ad-hoc 署名ビルド。以後はメニューから更新できる）で実投稿を書く。違和感は backlog へ。特に抽出が汎用語を特徴語に拾う件
2. **配布（#25）— 本人用の一周が完了（2026-09-23）**。v0.2.0 → v0.2.1 → v0.2.2 を GitHub Releases に公開し、インストール済みの 0.2.0 からメニュー「アップデートを確認…」→ ダウンロード → 再起動で 0.2.2 に上がることを本人が確認。残りは Apple 署名・公証（D-51、使い心地に自信が持てたら）と Homebrew の有効化（`HOMEBREW_TAP_TOKEN` ＋ 変数 `HOMEBREW_TAP_ENABLED=true`）。できたもの: PATH 修正（`fix-path-env`）、メニュー（Lita › アップデートを確認…、編集、ウインドウ）、アプリ内アップデーター（`tauri-plugin-updater`、鍵はキーチェーン `lita-tauri-updater-key` ＋ Secret `TAURI_SIGNING_PRIVATE_KEY`）、`release.yml`（`v*` タグで GitHub Releases に公開）、`homebrew.yml`（公開時に tap `Papillon6814/homebrew-lita` の cask を更新）、`npm run release -- x.y.z`。**当面は本人用のみ（D-51）**。Apple 加入は使い心地に自信が持てたら。そのとき: Apple Developer Program 加入 → Developer ID 証明書と App Store Connect API キー → Secrets（`APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `KEYCHAIN_PASSWORD` / `APPLE_SIGNING_IDENTITY` / `APPLE_API_ISSUER` / `APPLE_API_KEY` / `APPLE_API_KEY_CONTENT`）。Homebrew 用に fine-grained PAT（tap の contents: write）を Secret `HOMEBREW_TAP_TOKEN` に。初回リリース `v0.2.0` は 1 回目の Actions が「identity \"\"」で失敗（未設定 Secret が空文字で渡る）→ `release.yml` で Apple 変数は設定時だけ export、無ければ `APPLE_SIGNING_IDENTITY=-`（ad-hoc）に修正し、タグを打ち直した。決定は D-47〜D-50。サイドバーの「採用した」「保管」は本人の要望で外した（D-52、2026-09-23）

## 触る前に知っておくこと

- **要件と UI/UX は専任エージェントが責任を持つ（2026-09-23）。** 本人の一言 → `lita-requirements` が `docs/pm/requirements/` に要件書 → `lita-ux` が `docs/pm/ux/principles.md` に照らして設計・UI 実装・モック確認（記録は `docs/pm/ux/`）→ コーディネーターが Rust 側や配線を足して PR → `lita-pm` が決定を記録。UI の変更を `lita-ux` を通さずに PR にしない

- **画面を確認するときは `npm run mock`**（`VITE_LITA_MOCK=1`）で `http://localhost:1430/?scene=<名前>` を開くか headless Chrome で撮る。シーン一覧は `src/platform/mock.ts` の先頭。Tauri を起動して GUI を自動操作するのは、他アプリに入力が飛ぶ事故があったので禁止。実操作の確認は本人に頼む。
- コード変更は必ず worktree + feature branch で行います。main 直コミットは禁止です。worktree を切ったら `npm install` を忘れずに。
- `@tauri-apps/*` を import してよいのは `src/platform/` だけです（D-32）。
- **見た目の正は Claude Artifact のモック**（https://claude.ai/artifact/7m4i2ZmhNvQ1oMcZeJ1Mia）と `src/App.css` のトークンです。ライトのみ、生成りの紙色、ミント1色（文字と塗りは濃い #1d7f70、淡色は背景と縁取りだけ）、角丸は操作部品 8px / 入れ物 12px、書体は Zen Kaku Gothic New（`@fontsource` で同梱）。新しい画面はこのトークンだけで組みます。
- UI の原則（2026-09-22 の UX 批評で決定）: 正常時の状態表示は出さない（異常時だけ琥珀色のピル）。数字や内部制約を見せない（「足りているか」で言う）。エラーは平易な一文＋「詳細を表示」。Voice の一文の主語は常に「あなたの文章は」。名前は既定名で後から変える。
- 決定を変えるときは、**Notion の決定事項表**と **`docs/pm/decisions.md`** の両方を更新します。覆った決定は消さず「（日付 改訂）」を付けて残します。
- Codex のトークンには触りません。`codex` を起動するだけです。
- `cargo run -p lita-codex --bin probe` / `--bin corpus` / `--bin schema` は**アカウントの Codex 利用枠を消費します**（約70秒／約60秒／約3分）。
- アプリの Supabase URL と anon key は `src-tauri/src/config.rs` の定数です。どちらも公開値で、セルフホストする人はここを変えます。セッションは OS キーチェーン（service `com.papillon6814.lita`）にあり、起動時にリフレッシュしてから UI に渡します。
- 記事のモデルは D-45（`articles` ＋ `article_versions`）。生成は `write_article()`（src-tauri）に集約されていて、版の追加と本文の更新を一緒に行う。
- データアクセスは `lita-store::Store::as_user(access_token)` 経由のみ。RLS が所有者チェックを担うので、クレート側でユーザー絞り込みはしない。`cargo run -p lita-store --example roundtrip` で本番に対する一周検証ができる（ブラウザでのログインが1回要る。後始末込み）
- Voice の生成プロンプトには必ず `VoiceProfile::generation_view()` を使ってください。プロファイル全体を渡してはいけません（D-28）。投稿の生成は `lita-codex::post::generation_prompt` が組み、アプリの `preview_prompt` はそれと同じ文字列を返します（見せているものと送るものを一致させる）。
- v0.1 の完成定義に入らない提案は backlog に落とします。
- SQLite に戻す提案が出たら、まず D-36 の理由（別 PC での引き継ぎ）を確認してください。ローカル優先＋同期は保留項目（B-31）です。
- backlog の各項目は GitHub Issue（#11〜#25、マイルストーン v0.1 / v0.2、ラベル `backlog` / `deferred`）と1対1で対応しています。着手時は該当 Issue を自分にアサインし、新しい項目は backlog.md と Issue の両方に追加します。

## Google Cloud（2026-09-22 作成）

- 公開サイト（同意画面の必須項目）: `site/` → GitHub Pages（`.github/workflows/pages.yml`、カスタムドメイン lita.muumoo.online。DNS はムームードメインの設定2 に `lita CNAME papillon6814.github.io`）。プライバシーポリシーは `site/privacy.html`。扱うデータが変わったらここも直す

- プロジェクト `lita-509404`（組織 muumoo.online）。同意画面は External / **本番環境（2026-09-22 公開）**。スコープは openid / email / profile のみなので検証提出は不要だった。ブランディング: ホームページ https://lita.muumoo.online/、プライバシーポリシー https://lita.muumoo.online/privacy.html、承認済みドメインに muumoo.online と csfvqpqzvcorqlsmfjwb.supabase.co
- OAuth クライアント: 「Lita (Supabase)」（Web application、使用中）のみ。「Lita desktop」は 2026-09-22 に削除（キーチェーンの `lita-google-client-*` は残骸）。ID とシークレットはキーチェーン `lita-google-web-client-*`

## Supabase（2026-09-22 作成）

- 組織: `muumoo`（slug `swsrpyuhcrycgcolxaig`、Free プラン）。既存の「finn Org」には作成権限がなかったため新設
- プロジェクト: `lita`、ref `csfvqpqzvcorqlsmfjwb`、東京 ap-northeast-1、Postgres 17。ダッシュボード https://supabase.com/dashboard/project/csfvqpqzvcorqlsmfjwb
- DB パスワードは macOS キーチェーン（service `lita-supabase-db-password`、account `lita`）。リポジトリにも Notion にも書かない
- Google プロバイダは `supabase/config.toml` の `[auth.external.google]` で管理し、`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` を環境変数にして `supabase config push` で反映する（Storage 設定の読み取りエラーが出るが認証設定は適用される。CLI 更新で消える見込み）
- CLI は `--profile <name>` で複数アカウントを切り替えられる。別アカウントを使うときは本人が `supabase login --profile <name>` を対話で実行する
- `supabase/` はリポジトリにある（`config.toml` とマイグレーション）。worktree を切ったら `supabase link --project-ref csfvqpqzvcorqlsmfjwb` を再実行する（`.temp` は gitignore）。スキーマ変更は新しいマイグレーションファイルを足して `supabase db push`

## Notion（正）へのリンク

- 仕様本体: https://www.notion.so/3e29cda8bea1809e9077d080a350d218
- 技術仕様: https://www.notion.so/3e29cda8bea18131a10dc9037e9fa189
- 引き継ぎメモ: https://www.notion.so/3e29cda8bea1810caf0ec83deebc4302
