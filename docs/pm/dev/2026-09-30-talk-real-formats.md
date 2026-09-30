# #129 段 4 の見分けを、出典のあるコピーの形で直した報告

- 日付: 2026-09-30（lita-dev）
- ブランチ: `fix/129-talk-real-formats`（最新の main から）
- 照らしたもの: 要件 `docs/pm/requirements/2026-09-26-gather-writing.md`（必須 16〜25。特に 21・23 と「迷ったら会話と見なさず、他人の言葉を本人の名前の下に入れない」）、D-77、段 4 の報告 `docs/pm/dev/2026-09-26-gather-writing-stage4.md`
- 仕様は変えていません。画面・TS・i18n・DB は触っていません

## 1．やったこと

**段 4 の見本は推測だったため、出典のある実際のコピーの形（2026-09-30 の調査）で見本を作り直し、`talk::read` が他人の言葉・名前・画面の文字を本人の本文に入れないように直しました。** 直したのは `crates/lita-sources/src/talk.rs` の `Cues`（手がかりの 1 か所）と、読みの 2 か所だけです。道具の名前では分けていません（D-77）。

- **時刻の行の前の印**: `APP  9:12 PM`・`アプリ  10:25`（ボット）と `:palm_tree:  9:15 PM`（ステータス絵文字）を、時刻だけの行として読むようにした。印は名前にならず、上の行が名前になる
- **ボットの扱い**: 名前の後の `APP`／`アプリ` を外し、**人と同じ規則で読む**（`Jira Bot アプリ  10:25` は話者「Jira Bot」。名前の行＋時刻の行の形では、人と同じく 2 回以上現れたときだけ名前になり、1 回だけなら本文は誰のものにもならない）。理由はコメントに書いた: ボットを自分として選ぶ人はいないので、どちらでも本文は本人から離れる。ボットだけの別規則を持つより保ちやすい
- **画面の文字（chrome）を追加**: `+2`（スレッドの顔の数）、`.` だけの行、`2件の返信 最終返信: 12日前`／`4 replies Last reply …` が 1 行の形、Discord の `Image`・`Expand`・`10 KB`、`(編集済)`・`（編集済）`、以前の Teams のリアクション行 `angry 1` など（`like|heart|laugh|surprised|sad|angry` と数）、LINE の `☎ …`、`[位置情報] 住所`・`[ノート] …` など括弧の後に文字が続く形、LINE の名前の欄が空のシステム行（`00:10<TAB><TAB>…`）
- **リンクのプレビュー**: `Website` の行と、その直下の 1 行（タイトル）を落とす（出典の例がこの 2 行の形のため）
- **本文の中**: LINE の `(emoji)` を消す
- **メールの前置き**: Apple Mail 日本語の `…<addr>のメール:`、`名前 wrote on 2023/06/15 17:34:`（日付か時刻があるときだけ）、`*From:*`＋`*Sent:*`
- **`[15:12] 名前`（以前の Teams の 24 時間表記）**: `[10:24]本文`（同じ人の続き）と同じ形なので、その文字が**別の確かな見出し（弱い形でない見出し）の名前と同じときだけ**その人の見出しにする。名前がどこにも無ければ今までどおり続きとして読み、会話としては分けない（`Unsure`）
- Teams の見本（`TEAMS_GUESSED`・`TEAMS_INLINE_GUESSED`）のコメントを調査結果に合わせた（以前の Teams に近い形。今の Teams は本文だけをコピーする。インライン形は出典なし）

## 2．触ったファイル

- `crates/lita-sources/src/talk.rs`（`Cues` と `classify`・`intro`・`confirm_weak`・`clean`、テスト 13 本追加、既存 1 本に 1 例追加）
- この報告

## 3．見本ごとの結果

見本はすべて架空の名前と文で、形だけを出典に合わせました（`samples/*.txt` を元に fixture 化）。「前」は直す前の `read` の結果（新しいテストを先に書いて落ちたときの出力と、コーディネーターの確認）です。

| 見本（テスト） | 前 | 後 |
| --- | --- | --- |
| Slack 英語の実物の形（`slack_en_real_copy`） | 話者 `["Alex Rivera", "APP", ":palm_tree"]`。Dan Na が消え、Dan Na の発言が APP／:palm_tree の下に入る。Alex の本文に `+2` と `GitHub` | 話者 `["Dan Na", "Alex Rivera"]`。Alex の本文は本人の 3 通だけ。1 回だけのボット GitHub の本文は誰のものにもならない |
| Slack 日本語 2 行の形（`slack_ja_two_lines`） | 本文に「2件の返信 最終返信: 12日前」。話者に「Jira Bot アプリ」 | 本文は本人の 3 通だけ。話者は「Jira Bot」（印を外す） |
| ボットの印が別の行（`a_bot_mark_is_not_a_name`） | 話者に「アプリ」 | 話者は本人だけ。ボットの本文は誰のものにもならない |
| LINE の .txt 実物の形（`line_history_real`） | システム行が名前なしの発言になる、取り消しが直前の本文に連結、`[位置情報] 住所`・`☎ 通話時間 0:07`・`(emoji)` が残る | 名前なしの発言は無し。本人の本文は 2 通だけ（`"` の囲みも外れる） |
| LINE 英語 `Saved on: 11/04/2018 17.55`（`line_history_en_saved_on_with_dots`） | 通る（`Saved on` の行ごと落ちていた） | 同じ |
| LINE の古い空白区切り（`line_history_old_spaces_is_not_split`） | `Unsure` | 同じ（名前の終わりが分からないので分けない。懸念 2） |
| Discord 英語の実物の形（`discord_real_copy`） | 本文に `Website`・`Listen to classic jazz track...`・`Image` | 本人の本文 3 通だけ |
| Discord 日本語 `(編集済)` だけの行（`discord_ja_edited_line`） | 通る（行の中の消去で空になっていた） | 同じ。行ごと落とす chrome も足した |
| Apple Mail 日本語（`mail_apple_ja`） | `Plain`（引用された相手の文が本人の文章として入る） | 会話。名前なしの本人の返信 1 行だけ |
| `*From:*`・`wrote on`（`mail_other_intros`） | `Plain`（相手の文が入る） | 本人の返信だけ |
| 新しい Teams（`teams_new_copies_text_only`） | `Plain` | 同じ（正しい） |
| 以前の Teams（`teams_old_format`: `[Yesterday 8:15 AM] James Smith`、`[1:41 PM] Rivera, Alex`、` angry 1`、`[15:12] Rivera, Alex`） | 本文に `angry 1`。`[15:12] Rivera, Alex` 以下が James Smith の続きになる | 本人の本文 2 通だけ |
| 24 時間表記だけの `[15:12] 名前`（`clock_then_name_alone_is_unsure`） | — | `Unsure`（分けない） |
| 散文の `As Drucker wrote on Sep 30:`（`wrote_in_prose_is_plain` に追加） | — | `Plain` |

既存の 24 本（段 4 の見本と散文）はすべて通ったままです。

## 4．実行したコマンドと結果

- `cargo test -p lita-sources talk::` → 先に新しいテストを書き 8 本失敗を確認 → 直して 37/37
- `cargo test --workspace` → 159 本すべて通過（lita-sources 45）
- `cargo clippy --workspace --all-targets` → 警告は `lita-codex` の既存のものだけ（`talk.rs` は 0）
- TS は触っていないため `npm run build` は省略。画面は変えていないため撮影なし

## 5．判定

| 条件 | 判定 |
| --- | --- |
| 見本 1〜5 で、他人の発言・名前・時刻・画面の文字が本人の本文に残らない | ◎ テストで確認 |
| ボットの扱いが一貫し、理由がコメントにある | ◎ `name_stamp` のコメント |
| 見本 6（新しい Teams）は `Plain`、Teams のコメントを直す | ◎ |
| 以前の Teams の実形 | ◎ 通る（`[15:12] 名前` は名前が別に見出しで出るときだけ） |
| `Cues` に集約、道具名で分けない | ◎ 印・chrome・前置きは `Cues`。読み側の追加は `Website` の直下 1 行と `[時刻] 名前` の確かめの 2 つ |
| 既存テストが通る | ◎ |

## 6．出典（調査メモ `chat-copy-formats.md` より）

- Slack 英語の実物: https://blog.danielna.com/slack-copy-paste/ 、正規表現 https://www.danielna.com/labs/slack-copy-paste/slack-copy-paste.js 【確度：中〜高】
- Slack の古い形: https://github.com/neo4j-contrib/neo4j-apoc-procedures/issues/603 、https://pastebin.com/jazSyf45
- Slack 日本語の文言: https://www.docswell.com/s/ydnjp/Z8E3XK-2022-08-08-103349 【確度：低（行の並びは英語からの類推）】
- Teams: https://learn.microsoft.com/en-us/answers/questions/4425081/ 、https://learn.microsoft.com/en-us/answers/questions/1850849/ 、https://learn.microsoft.com/en-us/answers/questions/2179821/ 、https://learn.microsoft.com/en-in/answers/questions/5965220/ 、https://superuser.com/questions/1742038/ 、https://techcommunity.microsoft.com/discussions/microsoftteams/teams-copying-text-includes-persons-name/3247224 【確度：高】
- Discord: https://raw.githubusercontent.com/langchain-ai/langchain/v0.0.340/docs/docs/integrations/chat_loaders/discord.ipynb 【中〜高】、日本語 https://wiki3.jp/japari-group/page/743 【低〜中】
- LINE の .txt: https://github.com/nakasyou/Patchouli 、https://github.com/jyu0414/linelog2py 、https://qiita.com/shimajiroxyz/items/9a06a086ee9730ee3d55 、古い形式 https://qiita.com/sorax/items/82ea40cccd916b4a2a61 【高】
- メール: https://lists.w3.org/Archives/Public/public-i18n-japanese/2023OctDec/0408.html （Apple Mail 日本語）、https://lists.w3.org/Archives/Public/public-i18n-japanese/2021JulSep/0247.html （`*From:*`）、https://www.gakunin.jp/ml-archives/upki-fed/msg01557.html （`wrote on`）【高】

## 7．残る懸念

1. **Slack のスレッドを開いたときの `  3 days ago`**: 時計が無いので名前の行＋時刻の行として読めず、上の名前の行が直前の人の本文に入るおそれがあります。「時計のある行」の条件を広げると散文の誤判定にも触れるため、今回は足していません
2. **LINE の古い空白区切り形式**（`15:16 名前 本文`）: 名前の終わり（名前に空白が入る）が分からないため分けず、`Unsure` のまま（全部が自分の文章として入る前に一文が出る）です
3. **リンクのプレビュー**: `Website` と直下 1 行だけを落とします。出典の例がこの 2 行の形だからです。説明文が複数行のプレビューでは、2 行目以降が本文に残ります
4. **Slack 日本語 UI の行の並び**は英語からの類推（確度 低）です。本人の端末での実際のコピーで確かめる必要があります（調査メモ 8-1）
5. `[15:12] 名前` は、その名前が別の場所で見出しとして出るときだけ分けます。24 時間表記だけの以前の Teams は `Unsure` になります（今の Teams では出ない形）
6. Google Chat・Chatwork は根拠が無いため触っていません
