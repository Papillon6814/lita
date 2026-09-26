# #129 段 2「その場で足す」の実装

- 作成日: 2026-09-26
- ブランチ: `feat/129-slack-entry`（main 12ba72c を取り込み済み）
- 要件: `docs/pm/requirements/2026-09-26-gather-writing.md` の段 2（必須 1〜6、13〜15、受け入れ条件 1・2・7）。決定は D-55・D-57・D-66・D-71・D-72・D-75
- UX 設計書: `docs/pm/ux/2026-09-26-gather-writing-stage2-4.md` の段 2（3.1 節、場面 ①〜⑥、`design/gather-add.html`）
- 本人の決定（2026-09-26、設計書 9 節の論点 1）: 「文章を足す」は**雲が出ないときだけ**出す。雲が出たあと雲の見出しの右には置かない
- 引き継いだ宿題: 段 1 レビュー 4 節の 1（文章 0 本・記事だけの人の雲の場所に次の一手）、4 節の 2（拾っている行と次の一手を同時に出さない）
- この PR に含めた未コミットの docs（中身は変えていない）: 要件書の改訂（段 4＝D-77）、`decisions.md`（D-74〜D-77）、設計書 `2026-09-26-gather-writing-stage2-4.md`、`design/gather-add.html`・`gather-talk.html`・`_gather.css`、`docs/pm/ux/gather-writing/design/*.png`

## やったこと

| 必須 | 中身 | 直し方 |
| --- | --- | --- |
| 1・6 | 雲が出ないとき、雲の場所に一文＋次の一手を 1 つだけ出す。文章 0 本（おすすめの文体、記事だけの人を含む）でも同じ。文体 0 なら今までどおり「まず文体を作りましょう」 | 雲の箱を「文体があり、題がまだ出ていなければ常に」置く（題が出たあとは、言葉が無ければ箱ごと出さない）。箱の中は 3 つのどれか 1 つ: A 文章 0 本「あなたの文章を足すと…」＋「文章を足す」／B 言葉が 3 つ未満「拾えた言葉がまだ少なく…」＋「文章を足す」／C 最初の拾いを止めた「言葉を拾うのをやめました。」＋「拾い直す」。拾っている間と失敗のときは今の一文だけ（一手は出さない）。雲の見出しの「拾い直す」は言葉があるときだけ。「題を出す」は常に右下（`stack alone` をやめた） |
| 2 | 押すと画面を離れず、既存の部品がその場に開く。モーダルにしない | 雲の箱の場所に「文章を足す」＋「閉じる」の区画を開く（編集方針と同じ組み方）。中身は `add.where` の一文、`PasteBox`（貼る・.txt/.md）、「どちらも入れられます。」、`SourceBox`（note・Medium・X）。開くと貼る欄にキーボード、「閉じる」か Esc で閉じて「文章を足す」にキーボードを戻す。編集方針とは同時に開かない。「題を出す」を押すと区画を閉じる（貼りかけは捨てる） |
| 3 | 足した文章は直近の記事の文体の「元にした文章」へ | `voiceId`（D-55 の選び方で既に持っている）の文体。空（文体 2 つ以上・記事 0）なら一覧の先頭。`host.addVoiceSources` をそのまま使う（Rust・DB は無変更）。つないだ行はその文体の `voice_sources` から ✓ で出し、`known` で取り込み済みを除く |
| 4 | 文体は学び直さない | `addVoiceSources` は学び直さない（既存）。学び直しの呼び出しは足していない |
| 5 | 足し終えたら画面を離れずに自動で拾い、雲が出る | 足せたら区画を閉じ、`gather(true)` を呼ぶ。拾っている間・中止は今の「拾う」と同じ。note などをつないで取り込み終えたときも同じ。3 語に届かなければ B に戻り、同じ一手でもう一度足せる |
| 13 | 数字を出さない | 新しい文言に数字は無い。取り込み部品の「n 本として読みます」はそのまま |
| 14 | 失敗は平易な一文、画面の残りと「題を出す」は使える | 保存に失敗したら区画は開いたまま、貼った文字も欄に残し、区画の下に `ErrorNote`。「題を出す」は押せる。前の雲は触らない |
| 15 | 画面の語 | 「文章」「元にした文章」「言葉」だけ |

部品の直し（範囲は段 2 に要る分だけ）:

- `PasteBox`: `onAdd` が Promise を返してもよくし、reject されたら欄の文字を残す（今までの呼び出し元は void を返すので動きは同じ）
- `SourceBox`: `onRemove` を省けるようにし、省いたら「外す」を出さない（設計書 7.1。この画面で破壊的な操作を並べない）

見え方（CSS、既存のトークンだけ。値は `design/_gather.css` のとおり）: `.cloud-invite`、`.add-open`、`.add-why`。加えて、言葉が無いときの「拾っています」「拾えませんでした」の一文を箱の中央に置く `.cloud-note.lone`（設計書の ③ `add-3.png` が中央寄せのため）。使わなくなった `.stack.alone` を消した。

文言（ja・en を同じ意味で）: `cloud.invite`・`cloud.thin`・`cloud.stopped`・`cloud.add`・`add.where`。

mock の場面: `topics-add-empty`（おすすめの文体だけ、文章 0・記事 0）、`topics-add-open`（同じで区画が開いた状態から）、`topics-add-failed`（同じで、足すと保存に失敗する）、`topics-add-articles`（記事はあるが本人の文章は 0 本）、`topics-cloud-stopped`（文章あり・雲なし・最初の拾いを止めた）。`topics-cloud-few` の説明を今の見え方に直した。

## 設計書と違えたところ

1. **段 4 の部分は入れていない。** 設計書の ② のモック（`gather-add.html`・`add-2.png`）には貼る欄の見出しの右に「チャットの会話も、そのまま貼れます。…」（`paste.talkHint`）があるが、これは段 4 の必須 17 なので今回は出していない。段 4 で足す。
2. **本人の決定 1 に従い、雲が出たあとの「文章を足す」は置いていない。** 設計書 9 節の論点 1 の推奨（残す）は不採用。設計書の ④（`add-4.png`）はもともと置いていないので、見え方は ④ と同じ。
3. **`add.title` のキーは作らず `cloud.add` 1 つにした。** 設計書 6 節で「キーを 1 つにしてもよい」とあるため（区画の見出しと一手が同じ語）。
4. 設計書 7.2 の「`voiceId` が空のときは `listVoices` の先頭」に加え、`voiceId` がどの文体にも当たらないときも先頭を使う（記事の文体が消されている場合に「足した先」が空にならないように）。
5. 状態 C（止めた）の条件を「雲が無い」に加えて「下限未満の雲があり、そのあと文章が増えていて、開いたときの拾い直しを止めた」も含めた。こうしないと B の「文章を足す」と、今の「新しい文章が増えています。拾い直す」が箱の中に 2 つ並ぶ（原則 6）。同じ理由で「新しい文章が増えています」の一文は言葉が並んでいるときだけ出す（段 1 まではこの場合は箱ごと出ていなかったので、今までの見え方は変わらない）。

## 触ったファイル

- `src/components/TopicPicker.tsx`（雲の箱の条件と中身、区画「文章を足す」の開閉・足す・自動で拾う、mock の場面の入口）
- `src/components/PasteBox.tsx`（`onAdd` の失敗で欄の文字を残す）
- `src/components/SourceBox.tsx`（`onRemove` を省ける）
- `src/App.css`（`.cloud-invite`・`.cloud-note.lone`・`.add-open`・`.add-why`、`.stack.alone` を削除）
- `src/i18n/ja.ts`・`src/i18n/en.ts`（5 キー）
- `src/platform/mock.ts`（5 場面、`topics-add-failed` の保存失敗）
- Rust・DB・`src-tauri/` は無変更

## 実行したコマンドと結果

- `git merge origin/main`（12ba72c、段 3 #133 まで）→ fast-forward、衝突なし。`package-lock.json` の版の差分（0.2.13 → 0.2.24、worktree 由来）は戻した
- `cargo test --workspace` → 75 passed, 0 failed（7 + 53 + 8 + 7）
- `cargo clippy --workspace --all-targets` → 既存の警告のみ（`lita-codex` 8 件、`lita` 1 件。今回 Rust は無変更）
- `npx tsc --noEmit -p tsconfig.json` → エラーなし
- `npm run build` → 成功
- `npm run mock` → headless Chrome（1120×900）で静止画を撮影。流れ（押す・貼る・足す・拾う・文体ページ・Esc・保存失敗）は、headless Chrome を DevTools Protocol で動かして撮った（スクリプトは scratchpad に置き、commit していない）。撮影後 `pkill -f "vite.*1430"`
- 画面の自動テストの仕組みはこのリポジトリに無いため、TS の先に失敗するテストは書いていない（Rust は無変更）

## 受け入れ条件ごとの判定

| 条件 | 確かめ方 | 判定 |
| --- | --- | --- |
| 1: おすすめの文体だけ（文章 0・記事 0）で開くと、雲の場所に次の一手が 1 つだけあり、約束だけの一文は無い | `topics-add-empty`（ja・en） | ◎。一文と「文章を足す」が同じ行。主ボタンは右下の「題を出す」1 つ |
| 2: 押すと画面を離れず貼る欄とつなぐ行が開き、貼って足すと画面を離れず言葉が拾われて雲が出る。足した文章は文体ページの「元にした文章」に 1 本 1 行、8 項目は変わらない | `topics-add-empty` で「文章を足す」→ 2 段落を貼る →「足す」→ 拾っている → 雲 → サイドバー「文体」 | ◎（mock）。貼った 2 本が「元にした文章」に 1 本 1 行で並び、8 項目はそのまま（学び直しを呼んでいない）。1,500 字の実物と本物の Codex での拾いは未確認（懸念 1） |
| 7（段 2 の分）: 取り込みに失敗しても平易な一文が出て、何も保存されず、「題を出す」は押せる | `topics-add-failed` で貼って「足す」 | ◎。区画は開いたまま、貼った文字（93 字）が欄に残り、区画の下に「インターネットに接続できませんでした。…」。「題を出す」は押せる（`disabled=false`）。会話の貼り付けは段 4 |
| 段 1 レビューの宿題 1: 文章 0 本・記事だけの人にも次の一手 | `topics-add-articles` | ◎。記事があっても本人の文章が 0 本なら A の一文と「文章を足す」 |
| 段 1 レビューの宿題 2: 拾っている行と次の一手を同時に出さない | `topics-cloud-first`、流れの「拾っている」の画 | ◎。拾っている間は「言葉を拾っています… やめる」だけ |
| 本人の決定 1: 雲が出たあとは「文章を足す」を出さない | 流れの「雲」の画、`topics-cloud-more` | ◎。見出しの右は「拾い直す」だけ |

## 画（PNG）

`docs/pm/ux/gather-writing/impl/` に置いた。

| 画 | 場面 | 見比べる設計の画 |
| --- | --- | --- |
| `stage2-topics-add-empty.png`・`stage2-topics-add-empty-en.png` | ① 文章 0 本 | `add-1.png` |
| `stage2-topics-add-open.png`・`stage2-topics-add-open-en.png` | ② 区画が開いた | `add-2.png`（段 4 の 1 文は無い） |
| `stage2-topics-add-empty-flow-2-pasted.png` | 2 段落を貼った | ― |
| `stage2-topics-add-empty-flow-3-gathering.png` | ③ 足した直後、拾っている | `add-3.png` |
| `stage2-topics-add-empty-flow-4-cloud.png` | ④ 雲が出た | `add-4.png` |
| `stage2-topics-add-empty-flow-5-voice.png` | 文体ページの「元にした文章」に 2 行 | ― |
| `stage2-topics-cloud-few.png` | ⑤ 言葉が 3 つ未満 | `add-5.png` |
| `stage2-topics-cloud-stopped.png` | ⑥ 最初の拾いを止めた | `add-6.png` |
| `stage2-topics-cloud-few-flow-esc.png` | ⑤ から開いて Esc で閉じた（キーボードは「文章を足す」へ） | ― |
| `stage2-topics-add-failed-after-add.png` | 保存に失敗 | ― |
| `stage2-topics-add-articles.png` | 記事だけで文章 0 本 | `add-1.png` と同じ |
| `stage2-topics-cloud-first.png`・`stage2-topics-cloud-failed.png` | 言葉が無いときの拾っている・失敗（中央寄せ） | `add-3.png` |
| `stage2-topics-cloud-more.png`・`stage2-topics-picked-few.png` | 変えていない場面の見え方（回帰の確認） | ― |

## 懸念

1. **本物の Codex と 1,500 字の実物では試していない。** mock で流れを確かめただけ。材料が 1 本だけのとき、段 1 の下限（3 語）に届くかは材料次第で、届かなければ B「拾えた言葉がまだ少なく…」に戻る（設計どおり）。
2. **区画を閉じても、進行中の note などの取り込みは止まらない。** 取り込み終えると文体に足して拾い始める。つなぐを押したのは本人なので害は小さいと判断した。
3. **足す先の文体を画面で選べない。** `add.where` に文体の名前が出るだけ。文体が 2 つ以上あって記事が 0 本の人は一覧の先頭に入る（設計書 7.2 のとおり）。
4. `topics-add-failed` は設計書 7.3 に無い場面で、受け入れ条件 7 を画で確かめるために足した。
