# Playwright 専用 js_repl 実装計画

## 1. 目的

OpenAI Codex CLI の `js_repl` をそのまま移植せず、以下の制約を満たす **Playwright 専用 REPL ツール**を実装する。

- LLM には「ブラウザ起動 API」を公開しない
- 子プロセス (`child_process`) で実行エンジンを起動し、子プロセス側で `vm2` によって生成コードを実行する
- macOS 専用前提
- Node v22 前提
- ブラウザ起動挙動はユーザー設定 (`able.playwrightRepl.*`) で制御可能
- 既存 `able_run_in_sandbox` と同等に、安全側のデフォルトで運用する

## 2. 非目標

- 汎用 `js_repl` ツールの実装
- LLM から任意の Playwright 起動オプションを直接受け取る API
- Linux / Windows 対応
- 既存 `able_fetch_webpage` の置き換え

## 3. 既存コード調査の要点

- ツール登録は `activate` で行っている
  - `src/main.ts`
- 既存の安全実行基盤として `able_run_in_sandbox` があり、macOS `sandbox-exec` を利用している
  - `src/lmtools/runinsandbox.ts`
- Playwright 利用コードは既に存在（`chromium.launch({ headless: true })`）
  - `src/lmtools/fetchwebpage.ts`
- ツール定義は `package.json` の `contributes.languageModelTools` で公開している

## 4. 仕様確定（ユーザー合意済み）

- ツール名: `able_playwright_repl`
- リセットツール名: `able_playwright_repl_reset`
- 実行モデル: ステートフル（セッション維持 + reset）
- セッションスコープ: チャットセッション単位
- 起動設定: `able.playwrightRepl.*` で管理
- sandbox 許可ランタイム: `path`, `url`, `buffer` を追加許可する中間レベル
- 通信方針: デフォルト拒否、設定で明示許可
- 出力上限: `stdout/stderr` 各 16KB
- 実行タイムアウト: 15 秒
- ユーザー設定として公開する起動項目: `browserType`, `headless`

## 5. 全体アーキテクチャ

### 5.1 親プロセス（拡張側）

新規ツール `PlaywrightReplTool` を追加し、子プロセス管理・I/O 中継・セッション管理を行う。

責務:

1. 入力検証（コード空文字、サイズ上限など）
2. セッション単位で子プロセスを作成・再利用
3. JSON-RPC ライクなプロトコルで子プロセスに実行要求
4. タイムアウト時の強制終了
5. ツール結果を `LanguageModelToolResult` として整形

### 5.2 子プロセス（実行エンジン）

`src/lmtools/playwrightreplrunner.ts`（新規）を Node プロセスとして起動。

責務:

1. `vm2` の `NodeVM` を初期化
2. 親から受け取ったコードを `NodeVM` で実行
3. グローバルに `playwright` API を直接渡さず、内部で管理した `browser/context/page` をヘルパーとして提供
4. `console.*` 出力・戻り値・例外を JSON で返却
5. reset / dispose 時に `page/context/browser` を確実に close

### 5.3 重要設計（ブラウザ起動 API 非公開）

- LLM 入力コードは `browserType.launch()` を呼ばない
- 子プロセス側のホスト実装でのみ起動する
- LLM へは次の限定ヘルパーのみ公開
  - `pw.goto(url)`
  - `pw.click(selector)`
  - `pw.fill(selector, value)`
  - `pw.text(selector)`
  - `pw.locator(selector).click()`
  - `pw.getByRole(role, options)`
  - `pw.screenshot()`（必要なら base64 返却）
  - `pw.eval(fnOrExpression)`（安全性を見て段階導入）
- 起動オプションは親から子へ設定値として注入（LLM 非公開）

### 5.4 入力コードの構文検証（tree-sitter）

- 実行前に tree-sitter（JavaScript grammar）で入力コードを parse し、以下を検証する
  - 構文エラーの検出（fail-fast）
  - 禁止構文 / 禁止 import の早期検出（`child_process`, `worker_threads` 等）
- `vm2` 実行前段で弾くことで、説明しやすいエラーメッセージを返す
- 検証は「実行拒否ルール」と「警告ルール」を分離して段階運用できる形にする

## 6. セッション管理方式

### 6.1 基本

- `Map<sessionKey, ChildSession>` を `PlaywrightReplTool` 内に保持
- `sessionKey` は `handleToolStream` で取得できる `chatSessionResource` か `chatSessionId` を優先
- 取得できない場合は `default` キーにフォールバック（互換運用）

### 6.2 reset

- `able_playwright_repl_reset` は該当セッションの子プロセスを破棄して再生成
- 会話終了の明示イベントが取りづらい場合に備え、アイドル TTL（例: 5 分）で自動破棄

## 7. 子プロセス通信プロトコル（案）

1 行 1 JSON の newline-delimited JSON を採用。

### 7.1 親 -> 子

```json
{"id":"1","type":"exec","code":"await pw.goto('https://example.com')"}
{"id":"2","type":"reset"}
{"id":"3","type":"dispose"}
```

### 7.2 子 -> 親

```json
{"id":"1","ok":true,"stdout":"...","stderr":"...","result":"..."}
{"id":"1","ok":false,"stdout":"...","stderr":"...","error":{"name":"Error","message":"...","stack":"..."}}
```

## 8. 設定設計 (`package.json` contributes.configuration)

追加キー案:

- `able.playwrightRepl.browserType`: `chromium | firefox | webkit`（default: `chromium`）
- `able.playwrightRepl.headless`: boolean（default: `true`）
- `able.playwrightRepl.network.allow`: boolean（default: `false`）
- `able.playwrightRepl.network.allowedHosts`: string[]（default: `[]`）
- `able.playwrightRepl.timeoutMs`: number（default: `15000`）
- `able.playwrightRepl.maxOutputBytes`: number（default: `16384`）

補足:

- ユーザー合意済みの公開必須は `browserType`, `headless`
- それ以外は安全運用のため追加提案

## 9. セキュリティ方針

1. 防御の主軸は「別プロセス化」
2. `vm2` は第二防御層として使用（README の注意事項に従う）
3. `NodeVM.require` は allowlist 方式
   - builtin: `path`, `url`, `buffer`（必要最小限）
   - external: `playwright` のみ
4. `child_process`, `worker_threads`, `fs`, `net`, `tls`, `http/https` などは原則禁止
5. ネットワークはデフォルト拒否
   - 実装案 A: そもそも `pw.goto` が外部 URL を拒否
   - 実装案 B: `page.route('**/*')` で allowlist 以外 abort
6. タイムアウト時にプロセスグループ kill
7. 出力サイズ制限（16KB）

## 10. 実装タスク分解

### フェーズ 1: 骨格

1. `src/lmtools/playwrightrepl.ts` 新規
2. `src/lmtools/playwrightreplrunner.ts` 新規
3. `src/main.ts` に 2 ツール登録追加
4. `package.json` に 2 ツール定義追加
5. `package.json` に設定項目追加

### フェーズ 2: 実行基盤

1. 親側 child_process 起動・再利用
2. NDJSON 通信
3. タイムアウト・キャンセル時 kill
4. reset 実装

### フェーズ 3: Playwright ラッパー

1. 子側で browser/context/page ライフサイクル管理
2. `pw.*` API の最小セット実装（`locator`, `getByRole` を含む）
3. headless/browserType 設定反映

### フェーズ 4: 制約強化

1. `vm2` allowlist 制御
2. tree-sitter による実行前 validation
3. ネットワーク拒否（default） + 明示許可
4. 出力トリミング

### フェーズ 5: テスト

1. 単体テスト
   - セッション継続
   - reset 後の状態初期化
   - タイムアウト
   - 禁止 API アクセス
   - ネットワーク拒否
2. 統合テスト（可能範囲）
   - 実ブラウザ起動（headless）

## 11. 影響ファイル（予定）

- `src/main.ts`
- `src/lmtools/playwrightrepl.ts`（新規）
- `src/lmtools/playwrightreplrunner.ts`（新規）
- `package.json`
- 必要なら `src/chat/prompt.tsx` またはツール案内文
- テストファイル（新規）

## 12. リスクと対策

- `vm2` 単体の過信
  - 対策: 子プロセス分離 + 制限 + 定期アップデート
- Playwright の API 面積が広い
  - 対策: まずは `pw.*` 最小 API から段階拡張
- チャットセッション識別子取得の不確実性
  - 対策: `handleToolStream` 優先 + `default` フォールバック
- macOS sandbox-exec と Playwright の相性
  - 対策: 初期段階は `runinsandbox` とは独立運用し、必要なら後段で統合検討

## 13. 実装順序（最短）

1. Tool contribution + register（起動確認）
2. child_process + echo runner（通信確認）
3. vm2 でコード評価（純 JS）
4. Playwright 管理ラッパー導入
5. ネットワーク制限と reset
6. テスト追加

