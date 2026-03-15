# Playwright REPL ブラッシュアップ計画 v2

## 0. この文書の目的
- [plan.md](plan.md) の実装完了度が高い前提で、運用品質を上げる改善項目を定義する
- 重点は以下の 3 点
  - [src/playwright_repl/session.ts](src/playwright_repl/session.ts) の公開 API が実運用で十分か
  - able_playwrightrepl_exec の返却内容が LLM 利用に適しているか
  - 追加で効果が高い改善点の優先順位

## 1. 現状評価

### 1.1 session.ts で利用可能な API（現行）
- page
  - goto
  - click
  - fill
  - title
  - url
  - content
  - textcontent
  - screenshot
- context
  - cookies
- helpers
  - 空オブジェクト

### 1.2 充足性の結論
- 結論: 最小ユースケースには十分だが、LLM 主導の安定実行には不足
- 十分な点
  - 画面遷移、基本操作、本文取得、スクリーンショット取得は可能
  - セッション維持・reset により最小 REPL として成立
- 不足する点
  - 安定性: locator ベース操作や待機 API が不足
  - データ取得: DOM 評価系 API が不足
  - ネットワーク制御: route / response wait 系が不足
  - セキュリティ: 外部ネットワークアクセスの既定拒否が未整備
  - デバッグ性: console/request イベント可視化が不足

## 2. Playwright docs との差分（根拠）

参照元は [contexttmp/playwright/docs/src/api/class-page.md](contexttmp/playwright/docs/src/api/class-page.md) と [contexttmp/playwright/docs/src/api/class-browsercontext.md](contexttmp/playwright/docs/src/api/class-browsercontext.md)

### 2.1 既に公開済み（整合）
- Page.goto
- Page.click
- Page.fill
- Page.content
- Page.screenshot
- Page.textContent
- Page.title
- Page.url
- BrowserContext.cookies

### 2.2 未公開だが優先度が高い
- 安定性
  - Page.waitForSelector
  - Page.waitForResponse
  - Page.locator / getByRole 相当の安全 API
- データ取得
  - Page.evaluate
  - 属性取得 API（getAttribute 相当）
- ネットワーク制御
  - BrowserContext.route
- デバッグ性
  - Page.console / Page.request 系イベントの収集

## 3. value が undefined になる件

### 3.1 現状の原因
- [src/playwright_repl/kernel.ts](src/playwright_repl/kernel.ts) では各セルを async IIFE に包んで実行している
- セル末尾に return が無い場合、JavaScript 仕様上の戻り値は undefined になる
- [test/vscodeunittest/playwright_repl/playwright_repl.test.ts](test/vscodeunittest/playwright_repl/playwright_repl.test.ts) でも現状は `value: undefined` を期待している

### 3.2 v2 方針（ユーザー合意）
- value は固定サマリー運用に寄せる
- LLM が利用可能な値は、疑似 XML タグで明示的に返す
- 例
  - <status>ok</status>
  - <result>...</result>
  - <logs>...</logs>
  - <screenshots count="N">...</screenshots>
  - <error class="...">...</error>

### 3.3 期待効果
- LLM が規則的にパースできる
- `undefined` の意味論に依存しない
- 将来 JSON/DataPart 化へ移行しやすい

## 4. 改善提案（優先順位）

### P0（最優先）
- able_playwrightrepl_exec の出力フォーマットを疑似 XML 化
- 成功・失敗ともにタグ構造を統一
- Playwright のネットワーク制限を導入
  - 許可先ホストは `127.0.0.1` / `localhost` / `::1` のみ
  - 許可スキームは `http` / `https` のみ
  - 上記以外のアクセスは例外を投げて失敗にする
- REPL 実行時の Node.js ネットワーク制限を導入
  - `globalThis.fetch` 呼び出しを制限
  - 可能な範囲で `node:http` / `node:https` 経由の outbound を制限
  - 非許可先へのアクセス時は例外を投げて失敗にする
- テスト更新
  - 文字列一致ではなくタグ存在と主要値を検証

### P1
- session API 拡張（最小セット）
  - page.waitforselector
  - page.waitforresponse
  - page.evaluate（戻り値は JSON serializable のみ）
  - context.route（制限付き）
- 型・引数制約を明示し、runtime_guard と error_class を維持

### P2
- デバッグ観測性
  - console イベントの直近ログ取得
  - request / response の簡易トレース
- 出力上限・秘匿情報マスキング方針を追加

## 5. 非目標
- Browser 起動 API を LLM へ公開しない
- Seatbelt 導入は行わない
- Playwright 以外の汎用 helper は追加しない

## 6. 受け入れ条件
- 疑似 XML タグを使った結果が LLM から安定利用できる
- 既存の安全制約（syntax guard / runtime guard）を後退させない
- Playwright の通信は `127.0.0.1` / `localhost` / `::1` への `http/https` のみに制限される
- REPL からの `fetch` および `node:http` / `node:https` 通信は同一制約に従い、違反時は例外で失敗する
- API 追加後も reset と timeout 回復が維持される
- VS Code 統合テストで主要シナリオが通る
