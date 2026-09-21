# 検証記録: Slack の権限要件（B-02 / Issue #4）

- **実施日**: 2026-09-22
- **方法**: Slack 公式ドキュメントの調査 ＋ Voice に必要な発言数の実測
- **確度**: Slack 側の事実はすべて公式ドキュメント出典【確度：高】。ただし**実機での API 呼び出しは未実施**（Slack App の作成が必要で、PKCE 有効化が取り消せない操作のため）

## 結論

**「ボタン1つで Slack を連携する」という D-12 の前提は、Slack の規約上ほぼ塞がれています。** ただし同時に、**塞がれていることの実害が想定よりずっと小さい**ことも分かりました。

理由は、Voice を作るのに大量の発言が要らなかったからです。実測したところ**4件でプロファイルはほぼ安定**しました。大量取得を前提にした設計そのものが、そもそも要らなかった可能性があります。

## 1．Voice に必要な発言数（実測）

同一人物の発言 4件 / 8件 / 24件からそれぞれ Voice を生成し、プロファイルの動きを見ました。コードは `crates/lita-codex/src/bin/corpus.rs`、`cargo run -p lita-codex --bin corpus` で再現できます。

| 件数 | 一人称 | 絵文字 | 平均文長 | トーン |
| --- | --- | --- | --- | --- |
| 4 | 検出されず | true | 25 | 率直／簡潔／内省的／実務的／親しみやすい |
| 8 | 検出されず | true | 29 | 率直／簡潔／実務的／内省的／親しみやすい |
| 24 | 僕ら | true | 31 | 率直／簡潔／実務的／内省的／誠実／親しみやすい |

**トーンは4件の時点でほぼ確定**しており、24件まで増やしても1語増えただけでした。平均文長は 25→29→31 と収束しています。24件で増えた実質的な価値は、特徴語の豊かさと、一人称がようやく1回現れて拾えたことだけです。

**含意**: Voice に必要なのは数百件ではなく、**数十件**です。そしてこの規模なら、**本人が選んだ20件のほうが、機械的に集めた500件より良い Voice になる可能性があります**（気に入っていない文章が混ざらないため）。

## 2．Slack 側の制約

### 2.1 `search.messages`（当初の想定）— 形はぴったりだが、Slack が「使うな」と言っている

| 項目 | 内容 |
| --- | --- |
| スコープ | `search:read`（user token） |
| レート制限 | Tier 2、20+/分。100件/ページ |
| 有料プラン必須か | **必須ではない**。ただし無料プランは閲覧・検索とも直近90日に制限される |
| 状態 | **レガシー**。公式が明示的に非推奨 |

`from:<@UserID>` で**自分の発言だけ**を絞り込めます。100件/ページなので、**1リクエストで Voice の材料が揃います**。用途に対して形がぴったりです。

しかし Real-time Search API ガイドの禁止事項に、名指しの一文があります。

> 🚫 DON'T use the legacy `search:read` scope and related `search.messages` and `search.all` endpoints in API requests.

`search:read` スコープのページにも「This is a legacy scope」と書かれています。

### 2.2 Real-time Search API（後継）— Lita は使えない

> **No unlisted distributed apps allowed**
> The RTS API is available for directory-published apps and internal apps only.

Marketplace 未掲載のまま公開配布するアプリは対象外です。

### 2.3 `conversations.history` フォールバック — 用途に対して形が合わない

2025年5月29日以降、Marketplace 未承認の配布アプリは **1リクエスト/分・最大15件**（社内アプリと Marketplace 承認済みアプリは Tier 3 のまま：1000件・50+/分）。

しかし**レート制限以前に、このメソッドは形が合いません**。チャンネルの全員の発言が返るため、自分の発言だけを取るには取得して捨てることになります。自分の発言が全体の1割なら、50件集めるのに500件取得が要ります。Tier 1 では **33分**です。

### 2.4 マニフェスト配布という抜け道 — 規約で名指しで塞がれている

「ユーザー自身に社内アプリを作ってもらえば Tier 3 のまま」という回避策を検討しましたが、更新後の API 利用規約に次の記載があります。

> **Commercial Distribution**: The updated terms confirm that the Slack Marketplace is the only appropriate channel for commercially distributing apps built with Slack APIs, whether those apps are "unlisted" (published outside of the Marketplace) **or provide a customer instructions for a templated custom app that connects to your product**.

後半が、まさにこの回避策を指しています。加えて Developer Policy には「Circumventing Slack's intended limitations」の禁止があります。

**ただし「commercially distributed」が無償の OSS を含むかは、ドキュメントからは読み取れません**【確度：低】。これは技術ではなく規約解釈の問題なので、本人の判断が要ります。

### 2.5 公開配布とカスタム URI スキームの衝突（新たに発見・未解決）

配布ガイドに次の記載があります。

> Slack apps open to installation by other workspaces have additional security requirements. Your app must support SSL for all of the following URLs:
> - OAuth redirect URLs

一方、PKCE のガイドはカスタム URI スキーム（`lita://oauth`）を明示的に認めています。**この2つが両立するかは未確認です。** D-12 の「ボタン1つ」は PKCE + カスタムスキームが前提なので、ここが崩れると経路そのものが消えます。

## 3．副次的な発見

- **無料プランは直近90日**のみ閲覧・検索可能。ただし §1 の結果から、**実害は小さい**と考えられます。
- **PKCE のデスクトップリダイレクトでは bot scope を要求できません。** 自分の発言を読むだけなので影響なし。
- 無料プランはアプリ10個まで。
- `bot` / `incoming-webhook` / `commands` / `identify` 以外のスコープを使うアプリは、**インストールしたユーザーがワークスペースを離れると自動的にアンインストールされます**。

## 4．未検証のまま残ること

1. 公開配布の有効化が `lita://oauth` を受け付けるか（§2.5）
2. 新規アプリが実際に `search:read` を今も要求できるか
3. 「commercially distributed」が無償 OSS を含むか（規約解釈）

1と2は Slack App を1つ作れば確かめられますが、PKCE の有効化が取り消せないため、方針が決まってから実施すべきです。
