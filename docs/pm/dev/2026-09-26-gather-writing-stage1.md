# #129 段 1「取りこぼさない」の実装

- 作成日: 2026-09-26
- ブランチ: `feat/129-gather-writing`
- 要件: `docs/pm/requirements/2026-09-26-gather-writing.md` の段 1（必須 7〜10、13〜15）。決定は D-72・D-74・D-75
- UX 設計書: なし（段 1 は条件の直しだけ。文言は変えていない）

## やったこと

| 必須 | 中身 | 直し方 |
|---|---|---|
| 7 | 言葉が下限に満たない雲が保存されていても、文章が変わっていれば開いたときに 1 回拾い直す | `TopicPicker.tsx` の読み込み時の条件に「雲が下限未満、かつ今の本数が雲を拾ったときの本数と違う」を足した。言葉が足りている雲は今までどおり自動では拾い直さない |
| 8 | 下限を 5 → 3 語。Codex には材料が支える数だけ、最大 40（狙い 30） | `MIN_WORDS = 3`。`cloud_prompt` の指示と `cloud_schema` の説明から「20 以上」を外し、「少ないときは少なく、一般語で水増ししない」を足した |
| 9 | 雲は全部の文章を全体 40,000 字の中で読む。1 本は全体÷本数（最大 2,000 字、頭 3：末尾 1） | `topics.rs` に `cloud_samples_block` を足し、`cloud_prompt` だけがこれを使う。`topics_prompt`・`policy_prompt`・`brief_prompt` は今までどおり `samples_block`（24 本×400 字） |
| 10 | 材料の数は本人の文章（元にした文章の本数）だけで数える | `src-tauri/src/lib.rs` の `material_count` から記事の本数を外した |
| 13〜15 | 数字を出さない、失敗は既存の一文、画面の語 | 文言は変えていない。拾い直しに失敗したときは既存の「言葉を拾えませんでした。」＋「拾い直す」が出て、「題を出す」は押せる（既存の動き） |

## 触ったファイル

- `crates/lita-codex/src/topics.rs`（`cloud_samples_block`・定数 2 つ・`cloud_prompt`・`cloud_schema`・`TopicCloud::material_count` の説明、テスト 3 つ）
- `src-tauri/src/lib.rs`（`material_count`、`CloudView` の説明）
- `src/components/TopicPicker.tsx`（`MIN_WORDS`、開いたときの拾い直しの条件）
- `src/platform/mock.ts`（mock のみ。`topics-cloud-few` を 2 語に、`topics-cloud-three`・`topics-cloud-few-more` を追加）
- `docs/pm/ux/gather-writing/impl/*.png`（撮影）
- `docs/pm/requirements/2026-09-26-gather-writing.md`・`docs/pm/decisions.md`（lita-requirements の追記。中身は変えていない）

## 実行したコマンドと結果

- 先に失敗するテストを書いた: `cargo test -p lita-codex topics` → `cloud_samples_block` が無くてコンパイルエラー → 実装後 12 passed
- `cargo test --workspace` → 62 passed, 0 failed（7 + 43 + 8 + 4。前回 59 から 3 つ増）
- `cargo clippy --workspace --all-targets` → 既存の警告のみ（`crates/lita-codex/src/voice/` の 8 件、`src-tauri/src/lib.rs:1049` の 1 件。今回の差分とは無関係）
- `npx tsc --noEmit -p tsconfig.json` → エラーなし
- `npm run build` → 成功
- mock（`npm run mock` + headless Chrome、1120×900）で 5 場面を撮って目視
- 拾う時間の計測（下記）

### 拾う時間（必須 9 の仮置き「60 秒を超えたら全体を下げる」）

本人の本番の文章は Supabase にあり、実装担当からは読めません。代わりに、このリポジトリの `docs/pm/requirements/*.md`（日本語の散文）を 3,000 字ずつ 30 本に切って材料にし、`cloud_prompt` と `cloud_schema` をそのまま使って `codex exec`（`Effort::Quality`、`gather_topic_cloud` と同じ呼び方）を回しました。計測用の小さなプログラムは作業用ディレクトリに置き、commit していません。

| 材料 | 指示の字数 | 時間 | 返った言葉 |
|---|---|---|---|
| 30 本×3,000 字（予算いっぱい、1 本 1,333 字に切られる） | 41,174 | **22.0 秒** | 30 語 |
| 4 本×127 字（本人の本番の材料と同じ形） | 1,295 | 12.3 秒 | 9 語（20 語に水増しされない） |

60 秒を大きく下回るので、全体 40,000 字のままにしました。1 回ずつの計測で、Codex の混み具合でぶれます。

## 受け入れ条件ごとの判定

| 条件 | 確かめ方 | 判定 |
|---|---|---|
| 全体 3: 言葉が下限未満の雲が保存された状態で文章を足して開き直すと、自動で拾い直して雲が出る | mock `topics-cloud-few-more`（2 語の雲、文章が増えている）: 開いてすぐ「言葉を拾っています…」、そのあと雲が出る | ◎（mock） |
| 全体 4: 30 本つないだとき、25 本目以降にしか無い題材も雲に入る | `cloud_reads_every_sample_even_past_the_twenty_fifth`（30 本目の題材が雲の指示に入り、題の指示には入らない） | ◎（指示に入ることまで。Codex がその語を選ぶかは材料次第） |
| 言葉が 3 語の雲が出る | mock `topics-cloud-three` | ◎ |
| 記事を積んだだけでは「新しい文章が増えています」が出ない | `material_count` が元にした文章の本数だけになったことをコードで確認 | ○（自動テストなし。`material_count` は Supabase の store を要するため） |
| 拾う時間を測り PR に記録（60 秒以内） | 上の計測 | ◎（代わりの材料で 22.0 秒） |
| 数字を出さない・失敗は平易な一文・画面の語（13〜15） | 文言の変更なし。mock `topics-cloud-failed` は既存のまま | ◎ |

## PNG

- `docs/pm/ux/gather-writing/impl/topics-cloud-three.png`（3 語の雲）
- `docs/pm/ux/gather-writing/impl/topics-cloud-few.png`（2 語: 雲は出ず、代わりの一文も無い。段 2 で次の一手が入る場所）
- `docs/pm/ux/gather-writing/impl/topics-cloud-few-more-gathering.png`（下限未満の雲＋文章が増えた: 開いてすぐ拾い直している）
- `docs/pm/ux/gather-writing/impl/topics-cloud-few-more.png`（拾い直した後の雲）
- `docs/pm/ux/gather-writing/impl/topics-cloud-more.png`（言葉が足りている雲＋文章が増えた: 今までどおり一文と「拾い直す」だけで、自動では拾わない）

## 懸念

1. **自動の拾い直しの条件を「増えた」ではなく「変わった」にしました。** これまで保存された雲の本数は「文章＋記事」で数えていたため、新しい数え方（文章だけ）と比べると、文章を足しても「増えた」になりません（本人の本番の状態がまさにこれで、詰まりが直らない）。下限未満の雲に限り「本数が違えば 1 回拾い直す」にして、古い雲は開いたときに 1 回拾い直され、以後は新しい数え方で揃います。文章を外して本数が減ったときも 1 回拾い直しますが、下限未満の雲だけなので害は小さいと判断しました。
2. **言葉が足りている古い雲では、「新しい文章が増えています」がしばらく出ないことがあります。** 保存された本数に記事が含まれているため、文章の本数がそれを超えるまで出ません。一度「拾い直す」を押せば揃います。誤って出ることはありません。
3. **文章 0 本・記事だけある人は、雲の箱が出なくなります。** 雲の箱は「材料の数が 0 より大きい」ときだけ出る既存の作りで、材料の数から記事を外したためです。記事の題は Lita が出した題であることが多く、要件の「やらないこと」（Lita が出した題を材料にしない）と同じ向きなので、そのままにしました。段 2 の「その場で足す」が、この人の次の一手になります。
4. 拾う時間は本人の本物の材料では測れていません（上記）。本人の環境で一度測れると確実です。
