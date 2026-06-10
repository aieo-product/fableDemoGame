# Phase 4 作業ログ: デプロイ（Cloudflare Pages パブリック公開）

**手法**: メインループ（インライン）で wrangler CLI を直接実行。マルチエージェント化する規模ではないため単独作業と判断。

## 手順と意思決定

1. **認証**: CLAUDE.md の規約どおり、`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` を macOS Keychain からサービス名のみで取得し、シェルの環境変数としてその場で渡した（ファイルへの書き出し・平文保存は一切なし）。
2. **最終ビルド**: レビューフェーズの全修正を含む `npm run build` を実行 → `dist/` 585.73 kB（gzip 154.31 kB）。Three.js込みで約150KBに収まり、設計時のバンドル予算どおり。
3. **プロジェクト作成**: `npx wrangler pages project create fable-katamari --production-branch main`
   - Cloudflare Pages はデフォルトでパブリック公開（Cloudflare Access を設定しない＝誰でもアクセス可能）。ユーザー要件が「public公開」のため Access は意図的に設定しない。
4. **デプロイ**: `npx wrangler pages deploy dist --project-name fable-katamari --branch main`
   - `public/_headers` も同時にアップロードされ、ハッシュ付きアセット（/assets/*）に immutable キャッシュが効く。
5. **公開確認**:
   - `https://fable-katamari.pages.dev` → HTTP 200、`<title>Fable Katamari — 転がして、世界を呑み込め</title>` を確認
   - 検証エージェントが本番URLでブラウザ実機テスト（タイトル表示→開始→プレイ→HUD更新→コンソールエラー確認）を実施

## 結果

- **公開URL**: https://fable-katamari.pages.dev （パブリック、認証なし）
- 静的サイトのみ（サーバーレス）。今後の更新は `npm run build && npx wrangler pages deploy dist --project-name fable-katamari --branch main` で再デプロイ可能。
