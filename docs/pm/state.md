# Lita — 現在地

- **最終更新**: 2026-09-22
- **フェーズ**: 実装。ただし **2026-09-22 に保存方式が SQLite からサーバへ転換**（D-36〜D-39）。基盤は Supabase（D-40）
- **v0.1 の完成定義（D-21 で改訂）**: 気に入っている文章を20件ほど貼る → Voice を1つ生成 → ブリーフ入力 → X 用ポスト生成 → 承認 → クリップボードにコピー、が一周する

## できていること

| 項目 | 状態 |
| --- | --- |
| プロダクトの方向性の合意 | 完了 |
| 主要な技術選定 | 完了（Tauri v2 / Codex CLI サブプロセス / ~~SQLite~~ → Supabase/ MIT） |
| リポジトリの公開 | 完了（https://github.com/Papillon6814/lita） |
| PM エージェントの定義と状態ファイル | 完了 |
| Notion 仕様ページ | 完了 |
| Codex 呼び出しの検証 | 完了（型付き JSON・非リポジトリ実行・プリフライト） |
| Slack の権限要件の検証 | 完了。**v0.1 のスコープ変更に至った（D-20）** |
| 待ち時間の扱い | 完了。**問題設定が誤っていた（短文は6.6秒）。D-23〜D-26 を決定** |
| Voice スキーマの確定 | 完了。**12フィールド、`voice.rs` が正。引用は生成に渡さない（D-27〜D-30）** |
| Voice に必要な発言数の実測 | 完了。**4件でほぼ安定**、24件との差は語彙の豊かさのみ |
| `crates/lita-auth` / `crates/lita-store` | ログイン（Supabase 経由 PKCE）とデータアクセス（PostgREST）。単体テスト 8 件、本番向け example 2 本 |
| `crates/lita-codex` | Codex CLI のラッパー、`VoiceProfile` 型、`probe` / `corpus` / `schema` の3バイナリ、ユニットテスト9件 |
| **Tauri アプリの骨格** | **完了（2026-09-22）。`npm run tauri dev` で起動し、Codex の状態（ready / 未ログイン / 未インストール）を表示する。en/ja 対応** |

## できていないこと

| 項目 | 状態 |
| --- | --- |
| バックエンド基盤の選定 | 完了。**Supabase（東京）**（D-40） |
| Supabase プロジェクト | 完了（org `muumoo`、project `lita`、東京、ref `csfvqpqzvcorqlsmfjwb`） |
| Google OAuth クライアント | 完了（`lita-509404`、Web クライアント「Lita (Supabase)」） |
| Google ログイン | 完了（#26）。Supabase 経由の PKCE＋ループバック。`crates/lita-auth` |
| サーバ側スキーマ | 完了（PR #27）。RLS 付きで本番に適用済み |
| Rust の API クライアント | 完了（#11、`crates/lita-store`）。本番で一周検証済み |
| アプリ内サインイン | 完了（#30）。`sign_in` / `session_status` / `sign_out`、セッションはキーチェーン |
| 貼り付け／ファイル取り込みの UI | 未着手（v0.1 の入口） |

## いま効いている制約

### Codex 側（[検証記録](2026-09-22-codex-poc.md)）

1. **トークンストリーミングがない。** イベントは4種類だけで、答えは最後に一括で届きます。stderr にも進捗の中身はありません（確認済み）。**文字が流れる表示は作れません。**
2. **待ち時間の主因は推論量。** X ポスト1本は推論量 low で **7〜10秒**、medium で **11〜26秒**。プロンプトの大きさは推論が有効なときだけ効きます（D-30）。Voice 抽出は **45〜65秒**。
3. **JSON Schema には `description` が要る。** 型だけでは意図が伝わりません。
4. **Voice の引用は生成に渡さない。** 渡すと構造化フィールドが無視され、過去の文がそのまま出ます（D-28）。
5. **ユーザーの Codex 設定を引き継がない。** `--ignore-user-config` を常時付けます（D-25）。認証は `auth.json` にあるのでログインは維持されます。

### Slack 側（[検証記録](2026-09-22-slack-scopes.md)）

v0.1 では使いませんが、v0.2 で戻るときに効きます。

1. `search.messages` は用途に形がぴったり（`from:<@UserID>` で100件/リクエスト）だが、**公式が名指しで非推奨**。
2. 後継の RTS API は **unlisted distributed app に非開放**。
3. `conversations.history` は**形が合わない**（全員の発言が返る）うえ、Marketplace 未承認の配布アプリは 1リクエスト/分・15件。
4. マニフェスト配布の抜け道は**更新後の API 利用規約が名指しで塞いでいる**。
5. 公開配布は OAuth redirect URL に SSL を要求しており、`lita://oauth` と両立するか**未確認**。
