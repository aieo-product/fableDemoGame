# 作業ログ: Fable Katamari — ブラウザ3Dゲーム制作記録

**目的**: Fable 5（Claude）の性能検証として、塊魂ライクなブラウザ3Dゲームを ultracode
（マルチエージェントワークフロー）で設計〜実装〜デプロイまで完遂する。

**要件（ユーザー指示の要約）**:
1. ブラウザで動作する3Dゲーム（塊魂風: オブジェクトを取り込んで成長）
2. 成長に応じて「一段階大きい視界」へシームレスに移行する仕組み
3. 取り込みスケールが大きくなっても動作が重くならない設計
4. ultracode（マルチエージェント）で実行
5. 全作業の思考・意思決定・実装方法をログとして残す
6. Cloudflare Pages にパブリック公開

## 実行体制

| フェーズ | 手法 | ログ |
|---|---|---|
| 0. 環境準備 | メインループ（インライン） | 本ファイル |
| 1. 設計 | ワークフロー: 3視点並列提案 + 審査統合 | `01-design.md` |
| 2. 実装 | ワークフロー: モジュール分担並列実装 + 統合 | `02-implementation.md` |
| 3. レビュー/検証 | ワークフロー: 多次元レビュー + 敵対的検証 + 修正 | `03-review.md` |
| 4. デプロイ | メインループ + wrangler | `04-deploy.md` |

## Phase 0: 環境準備（メインループ）

- 作業ディレクトリ: `/Volumes/AIWorkSSD/AIWorkSpace/github/aieo-product/fableDemoGame`（空の状態から開始）
- `git init -b main`、`src/ docs/worklog/ public/` を作成
- **技術選定（メインループの初期判断）**:
  - **Three.js r177 + Vite 6**: ブラウザ3Dの事実上の標準。Cloudflare Pages への静的デプロイと相性が良い
  - **プレーンJS + JSDoc**: TSコンパイル層を省きビルドを単純化（設計フェーズで再検証）
  - 物理エンジンの要否・スケールシステムの方式は設計フェーズの判断に委譲
- Node 24.14.1 / npm 11.11.0 / wrangler 4.99.0（npx）を確認
- Cloudflare 認証情報（API Token / Account ID）が Keychain に存在することを確認（値は読み出さず存在確認のみ）

## Phase 1: 設計（ワークフロー `katamari-design`）

**狙い**: 単一案のバイアスを避けるため、3エージェントが互いを知らずに独立提案し、
審査エージェントが採点・統合する「judge panel」パターンを採用。

- 提案レンズ: ①パフォーマンス最優先 ②ゲーム体験最優先 ③シンプルさ最優先
- 各提案は構造化スキーマ（scaleSystem / physics / rendering / spawning / fileLayout / interfaces / risks）を強制
- 審査エージェントが最良案をベースに他案の長所を移植し、並列実装可能なファイル分割と
  モジュール間インターフェースまで確定させる

結果は `01-design.md` および `docs/DESIGN.md` に記録。
