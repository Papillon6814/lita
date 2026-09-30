# D-79「この文体で書く」を消した実装のレビュー（PR #141）

- 日付: 2026-09-30（lita-ux）
- 対象: PR #141（`fix/d79-remove-write-with-voice`、`f0d792a`）
- 照らしたもの: D-79（本人、2026-09-30。main の `decisions.md`）、D-69、D-55、D-56・D-58 の改訂、`principles.md`、実装報告 `docs/pm/dev/2026-09-30-d79-remove-write-with-voice.md`
- 画: lita-dev の `d79-remove-write-with-voice/impl/*.png` と、自分で撮った `d79-remove-write-with-voice/review/*.png`（1120×900）
  - `review/before-voice.png`・`review/before-voice-preset.png`: main（v0.2.26）で撮った変更前
  - `review/voice.png`・`review/voice-preset.png`: このブランチ（ja）
  - `review/voice-en.png`: このブランチ（en）

## 1．結論

**直しは要りません。そのままマージしてよいです。** 3 つの状態とも、余白の穴・並びの崩れ・行き止まりはありません。ボタンが消えたことで、文体ページの塗りボタンはサイドバーの「題から書く」だけになり、原則 3（主ボタンは画面に一つ）にむしろ近づきました。

## 2．判定表

合計: **満たす 5／部分 0／満たさない 0**

| # | 見ること | 見たもの | 判定 |
| --- | --- | --- | --- |
| 1 | ボタンが 3 状態のどこにも出ない | `review/voice.png`・`review/voice-preset.png`・`impl/intake.png`。文体 0 件の入口には元々無い | 満たす |
| 2 | 余白の穴・並びの崩れが無い（懸念 2） | 下の 3 節 | 満たす |
| 3 | 行き止まりが無い。文体ページから書きたい人が迷わない | サイドバーは `position: sticky; height: 100vh` で、ページを下まで送っても「題から書く」が同じ場所に見える。幅で隠れる指定も無い（`.frame` は常に 220px＋本文） | 満たす |
| 4 | 原則 3: 主ボタンは画面に一つ | 変更前は塗りボタンが 2 つ（サイドバー「題から書く」と「この文体で書く」）。変更後は 1 つ | 満たす（改善） |
| 5 | 英語でも同じ（原則 9） | `review/voice-en.png`。「Write from a title」が残り、見出しカードは「Lita writes like this」と一行で終わる。`voice.write` は ja・en の両方から消えている | 満たす |

## 3．見出しカードの下端の余白（lita-dev の懸念 2）

- 変更前: ボタンの下 22px（`.portrait` の内側の余白）で終わっていました。
- 変更後: 一行（`.lead`）または D-70 の一文（`.preset-note`）の下 12px ＋内側の余白 22px、画ではおよそ 36〜38px で終わります。上端（アバターの上 22px）より少し広いです。
- 判断: **指摘にしません。** 見出しカードは一行を読ませる場所で、下の「言葉」の見出しとの間に一呼吸ある方が、一行が詰まって見えません。穴に見える広さではなく、トークン（原則 8）も変えていません。
- 後で詰めたくなったときの一手（今回はやらない）: `.portrait` の中で最後に来た `.lead` と `.preset-note` の下の余白を 0 にすれば、上下とも 22px で揃います。

## 4．手数の前後（原則 10）

| やりたいこと | 変更前 | 変更後 |
| --- | --- | --- |
| 文体ページから、その文体で記事を始める | 「この文体で書く」1 回。ただし白紙の記事（または既存の空の記事）が開き、本文は自分で書く必要があった（D-69 と矛盾していた道） | 「題から書く」→（言葉を押すのは任意）→「題を出す」→ 題を選ぶ。文体は最後に使った文体（D-55）で、題が出たあとの 1 文に名前が出る。違う文体なら「変える」で選び直す（+2 回） |

増えた手数は D-79 そのものの代償で、本人が「ボタン自体を消す」を選んでいます。想定は文体 1〜2 本（原則 6）なので、「変える」が要るのは 2 本目の文体を見ていたときだけです。

## 5．残る懸念（直しではない）

1. **文体ページで見ていた文体が、「題から書く」に引き継がれません。** 2 本目の文体を直した直後に「題から書く」を押すと、最後に使った 1 本目で題が出ます（1 文に名前は出るので黙って違う文体で書くことはない）。引き継ぐかどうかは要件の変更なので、ここでは足さず、気になったら lita-requirements で扱ってください。
2. **英語の画面の撮り方。** mock には `&lang=en` がありません。言語は `navigator.language` で決まります（`src/i18n/index.ts`）。この Mac では次の組み合わせで英語になりました。Chrome が終わらずに残ることがあるので、撮れたら `pkill -f chrome-en` で止めます。

   ```
   LANG=en_US.UTF-8 LANGUAGE=en "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --lang=en-US --accept-lang=en-US --user-data-dir=<scratch>/chrome-en --window-size=1120,900 --force-device-scale-factor=1 --virtual-time-budget=3000 --screenshot=<path>.png "http://localhost:1430/?scene=voice"
   ```
