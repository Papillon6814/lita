# #129 段 3「使うほど育つ」の実装

- 作成日: 2026-09-26
- ブランチ: `feat/129-stage3-grow`
- 要件: `docs/pm/requirements/2026-09-26-gather-writing.md` の段 3（必須 10 の「直した記事を足す」、11・12）。決定は D-72・D-74・D-75
- UX 設計書: なし（段 3 は画面を変えない。画面のコードには触っていない）
- 引き継いだ宿題: lita-ux の段 1 レビュー（`docs/pm/ux/2026-09-26-gather-writing-stage1-review.md` の 3 節、懸念 4）「受け入れ条件 5 を段 3 で自動テストにする」

## やったこと

| 必須 | 中身 | 直し方 |
|---|---|---|
| 11 | 本人が直した記事の本文を雲の材料に入れる。Lita が書いたままの本文は入れない | `topics.rs` に `ArticleText`（今の本文と、Lita が書いたすべての本文）と `edited_by_person` を足した。「直した」は、本文が空でなく、Lita が書いたどの本文（`generated`・`shortened` の版）とも一致しないこと。Lita が一度も書いていない記事は、本文があれば「直した」になる。`gather_topic_cloud` だけが `own_bodies` の本文を、元にした文章の後ろに足して `cloud_prompt` に渡す |
| 10 | 材料の数に、本人が直した記事の本数を足す | `topics::material_count(元にした文章の本数, 記事)`。`get_topic_cloud`・`gather_topic_cloud` がこれで数える |
| 12 | 生成の契約と文体は変えない。雲のプロンプトにだけ入る | `topic_material`（題・編集方針・ブリーフが読むもの）、`topics_prompt`・`brief_prompt`・`policy_prompt`・生成の指示・`voice_sources` には触っていない。題と 1 行目は今までどおり「もう書いた題材」に使う |
| — | 数え方の版を 1 → 2 に上げ、前の数え方で保存された雲を数え直す | `CLOUD_COUNTING = 2`。`recount` に「今の直した記事の本数」を足す引数を加え、版 2 未満の雲は「拾った時点で既にあった文章の本数＋今の直した記事の本数」に数え直す（Codex は呼ばない） |

店（`lita-store`）には `article_texts()` を足しました。記事の `id,body` と、版の `article_id,body`（`kind` が `generated`・`shortened` のもの）を 2 回の読み取りで取り、記事ごとにまとめます。`prompt_sent` は読みません。

## 触ったファイル

- `crates/lita-codex/src/topics.rs`（`ArticleText`・`edited_by_person`・`own_bodies`・`material_count`、`CLOUD_COUNTING = 2`、`recount` の引数、`TopicCloud` の説明、テスト 4 つ追加・既存 3 つの呼び方を直した）
- `crates/lita-store/src/lib.rs`（`article_texts`、`ArticleText` の再公開）
- `src-tauri/src/lib.rs`（`material_count`・`get_topic_cloud`・`gather_topic_cloud`）
- 画面（`src/`）・i18n・mock は変えていない

## 実行したコマンドと結果

- 先に失敗するテストを書いた: `cargo test -p lita-codex topics` → `ArticleText`・`material_count`・`own_bodies` が無く、`recount` の引数も合わずコンパイルエラー（12 件）→ 実装後 20 passed
- `cargo test --workspace` → 70 passed, 0 failed（7 + 51 + 8 + 4。前回 66 から 4 つ増）
- `cargo clippy --workspace --all-targets` → 既存の警告のみ（`crates/lita-codex/src/voice/` の 8 件、`src-tauri/src/lib.rs:1063` の 1 件。後者は前回の 1055 行目が差分でずれただけ）
- `npx tsc --noEmit -p tsconfig.json` → エラーなし
- `npm run build` → 成功
- 画面を変えていないので、mock の撮影はしていない

足したテスト（`crates/lita-codex/src/topics.rs`）:

| テスト | 確かめること |
|---|---|
| `an_article_is_the_persons_only_when_they_changed_what_lita_wrote` | Lita が書いたまま（末尾の改行だけの違いを含む）は「直した」にならない。直した・自分で書いた記事はなる。前の Lita の版に戻しただけの記事はならない。空の記事はならない |
| `articles_lita_only_wrote_do_not_make_more_since_but_an_edit_does` | **受け入れ条件 5**。文章 2 本で拾った雲に対し、Lita が書いただけの記事 3 本では今の数が雲の数を超えない。そのうち 1 本を直すと超える（画面の `materialCount > cloud.material_count` と同じ比較） |
| `the_cloud_reads_the_body_the_person_edited_and_not_what_lita_left` | 直した記事・自分で書いた記事の本文にしか無い語が雲の指示に入る。Lita が書いたままの記事の本文にしか無い語は入らない |
| `a_cloud_counted_before_edited_articles_counted_is_recounted_with_them_as_already_there` | 段 1 の数え方（版 1）で保存された雲は、今ある直した記事を「既にあった」として数え直すので、版を上げただけでは「増えています」が出ない |

## 受け入れ条件ごとの判定

| 条件 | 確かめ方 | 判定 |
|---|---|---|
| 全体 5: 記事を 3 本積んで書き上がっただけでは「新しい文章が増えています」は出ず、1 本を本人が直してから開くと出る | `articles_lita_only_wrote_do_not_make_more_since_but_an_edit_does` | ◎（数え方の関数まで。Supabase を通した `article_texts` は自動テストなし） |
| 段 3 追加: 直した記事の本文にしか無い題材が、拾い直した雲に入る | `the_cloud_reads_the_body_the_person_edited_and_not_what_lita_left` | ◎（雲の指示に入るまで。Codex がその語を選ぶかは材料次第。段 1 の条件 4 と同じ扱い） |
| 段 3 追加: Lita が書いたままの記事の本文は雲の指示に入らない | 同上 | ◎ |
| 必須 12: 生成の契約と文体は変えない | 差分が `cloud_prompt` の呼び出し元と数え方だけであることを目で確認。`topic_material`・生成の指示・`voice_sources` は無変更 | ◎ |

## 懸念

1. **「Lita が最後に書いた版」ではなく「Lita が書いたどの版」とも比べています。** 要件の定義は「最後に書いた版から本文が変わっている」ですが、版の履歴から前の Lita の本文に戻した記事は、最後の版と違っても中身は Lita の言葉です。要件の「やらないこと」（Lita が書いたままの本文を材料にしない）に合わせ、どの Lita の版とも一致しないものだけを「直した」としました。最後の版とだけ比べる方がよければ、`edited_by_person` の 1 行で変えられます。
2. **比べるときは両端の空白だけを無視します。** 途中の 1 文字でも変われば「直した」になります。誤字を 1 字直しただけの記事も材料に入り、「増えています」が出ます（本文の大半は Lita の言葉のまま入る）。どこまで直したら本人の言葉とみなすかは要件に無いので、要件の文言どおり「変わっている」で判定しました。
3. **数え方の版上げで、段 1 の雲（版 1）は今ある直した記事をすべて「既にあった」として数え直します。** 段 1 で拾ってから今回までに直した記事は「増えています」に数えられません（誤って出ない側）。直した時刻は版の `created_at` から推せますが、`edited` の版は 50 件に間引かれるので確かではありません。段 1 はまだリリースされていない（v0.2.24 に入っていない）ので、影響するのは開発中に拾った雲だけです。
4. **拾う時間は測り直していません。** 直した記事の本文は元にした文章と同じ全体 40,000 字の予算の中で読むので、指示の長さの上限は段 1 の計測（予算いっぱいで 22.0 秒）と同じです。
5. `article_texts` は Supabase の実物では試していません（他の読み取りと同じ `get_many` で、RLS により本人の行だけが返る前提。`kind=in.(generated,shortened)` は PostgREST の `in` 演算子）。雲の画面を開くたびに読み取りが 2 回増えます。

## レビュー対応（/code-review、2026-09-26）

### 指摘 1: 版 2 未満の雲が毎回メモリ上でだけ数え直される

- **選んだ直し方: 数え直しを 1 回だけ行い、結果を保存して版を上げる。** `topics::recount` が「数え直したか」を返すようにし、`get_topic_cloud` は数え直したときだけ `set_topic_cloud` で保存します。次に開いたときは版 2 なので数え直さず、その後に直した記事は「増えています」に数えられます。Codex は呼びません。
- **時刻で比べる案を選ばなかった理由:** 直した時刻の手がかりは `edited` 版の `created_at` だけですが、この版は記事ごとに 50 件へ間引かれ、`edited` 版を作らずに直された記事もあります。時刻が読めない記事を「既にあった」とすれば今回と同じ漏れが残り、「新しい」とすれば誤って出ます。版 2 の雲は時刻ではなく本数で比べているので、比べ方を 2 通りにしないためにも、保存する案にしました。
- 残る影響: 段 1 で拾ってから初めて開くまでに直した記事は、その 1 回に限り「既にあった」扱いになります（懸念 3 と同じ。誤って出ない側）。
- テスト: `a_cloud_is_recounted_once_so_a_later_edit_makes_more_since`（1 回目は数え直して `true`、保存後に直した記事が増えると 2 回目は数え直さず「増えています」になる）

### 指摘 2: `article_texts` が `max_rows` で黙って切れる

- 記事と版を別々に読むのをやめ、記事 1 行ごとに、その記事の `generated`・`shortened` 版の本文を埋め込んで読みます（`select=id,body,updated_at,article_versions(body)` と `article_versions.kind=in.(generated,shortened)`）。記事と版が同じ行で届くので、版だけが切れて落ちることがありません。
- 全件はキーセットのページ送りで読みます（`order=id&limit=200&id=gt.<直前の id>`）。空のページが返るまで読むので、サーバーの上限が 200 より小さくても行は減らず、読む回数が増えるだけです。id で送るので、読んでいる途中に記事が直されて `updated_at` が変わっても、行が抜けたり重なったりしません。「新しい記事から」の並びは、読んだあとに `updated_at` で並べ直します。
- 安全側の判定: `ArticleText.lita_wrote` を `Option` にし、版が行に付いてこなかった記事は `None` として「直した」に数えず、雲の材料にも入れません。
- 同じ上限は `source_times()`（`voice_sources` の `created_at`）にもあり、指摘 1 で数え直しの結果を保存するようになったため、1,000 本を超える文章があると少ない数が残ります。同じページ送りに変えました。
- テスト（`crates/lita-store/src/lib.rs`）:
  - `read_pages_reads_every_row_even_under_a_cap_smaller_than_a_page`（1,234 行を 1 回 150 行までしか返さない相手から全件を読む。読んだ回数は 9 ページと空のページ 1 回）
  - `keyset_orders_by_id_and_starts_after_the_last_one`
  - `article_texts_come_newest_first_and_an_article_without_its_versions_is_not_the_persons`
- テスト（`crates/lita-codex/src/topics.rs`）: `an_article_whose_versions_were_not_read_is_not_the_persons`

### 触ったファイル

- `crates/lita-codex/src/topics.rs`（`recount` の戻り値、`ArticleText.lita_wrote` を `Option` に、テスト 2 つ追加）
- `crates/lita-store/src/lib.rs`（`article_texts`・`source_times` をページ送りに、`get_page`・`keyset`・`read_pages`・`article_texts_from` を追加、テスト 3 つ追加）
- `src-tauri/src/lib.rs`（`get_topic_cloud` が数え直した雲を保存する）

### 実行したコマンドと結果

- `cargo test --workspace` → 75 passed, 0 failed（7 + 53 + 8 + 7。前回 70 から 5 つ増）
- `cargo clippy --workspace --all-targets` → 既存の警告のみ（`crates/lita-codex/src/voice/` の 8 件、`src-tauri/src/lib.rs:1066` の 1 件。後者は行がずれただけ）
- `npx tsc --noEmit -p tsconfig.json` → エラーなし
- `npm run build` → 成功
- 画面は変えていないので、mock の撮影はしていない

### 懸念（追加）

6. **埋め込みとページ送りは、実物の Supabase では試していません。** 埋め込みの絞り込み（`article_versions.kind=in.(...)`）とページ送りの問い合わせは PostgREST の文書どおりの書き方ですが、ローカルの Supabase は起動していません。
7. **PostgREST の `max_rows` は埋め込みの配列にもかかります（1 記事あたり 1,000 版）。** 1 記事で Lita が 1,000 回以上書き直すことは考えにくいので、ここはページ送りしていません。
8. 雲の画面を開くたびの読み取りは、記事 200 本ごとに 1 回と最後の空のページ 1 回、文章 200 本ごとに 1 回と空のページ 1 回です（文章の読み取りは版 2 未満の雲のときだけ）。
