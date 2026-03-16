# Playwright REPL evaluate 対応と統合テスト再計画（2026-03-17）

## 目的

- [test/vscodeunittest/playwright_repl](test/vscodeunittest/playwright_repl) に Playwright REPL の統合テストを追加する
- [src/playwright_repl/playwrightrunner.ts](src/playwright_repl/playwrightrunner.ts) に `pw.evaluate(fn, arg?)` を追加する
- VS Code 統合テスト環境で `PlaywrightReplTool` を直接 `invoke` し、実ブラウザ実行を含む動作を確認する
- 最低 3 件の evaluate 系ケースを追加し、既存ケースと合わせて基本動作・エラー・セッション継続・reset を検証する

## 事前合意（ユーザー確認済み）

- 統合テスト範囲は「ツール実行まで必須」
- 環境依存を許容し、実ブラウザ実行の成否も検証する
- 最低ケース数は 10
- 実行経路は Chat 経路ではなく、統合テスト内で `PlaywrightReplTool` の直接 `invoke` でよい
- evaluate は `pw.evaluate(fn, arg?)` 形式で実装する
- `fn` は関数オブジェクトと文字列の両対応とする
- `arg` は単一引数のみ対応し、戻り値は JSON 直列化可能値を対象とする
- 統合テストではユーザー起動サーバー方式をやめ、テスト内でローカル HTTP サーバーを起動する（ランダムポート）

## 実装方針

1. [test/vscodeunittest/playwright_repl](test/vscodeunittest/playwright_repl) に新規テストファイルを追加する
2. 統合テスト内で Node HTTP サーバーを起動し、`pw.goto` / `pw.text` / `pw.click` / `pw.fill` / `pw.screenshot` / `pw.evaluate` を検証する
3. `PlaywrightReplResetTool` を使った session reset も検証する
4. evaluate 系を最低 3 ケース追加する（関数オブジェクト、文字列、arg 利用）
5. 失敗系（空コード、network deny）も継続して検証する
5. 実装後に `get_errors` で全体エラーを確認して修正する

## 非目標

- Chat UI からの end-to-end 呼び出し
- 外部インターネットに依存したページ検証

# Playwright 専用 js_repl 実装計画（改訂）

## 0. ドキュメント運用ルール

- plan.md は静的マスターとして扱う
  - 要件確定事項、設計方針、非目標、セキュリティ方針を保持する
  - 実装中の進捗で頻繁には書き換えない
- planexec.md は living doc として扱う
  - 実装フェーズ、現在ステータス、ブロッカー、次アクション、決定ログを継続更新する
  - 実装中の実態は planexec.md を正とし、完了後に必要差分のみ plan.md に反映する

## 1. 目的

OpenAI Codex CLI の js_repl をそのまま移植せず、以下の制約を満たす Playwright 専用 REPL ツールを実装する。

- LLM にはブラウザ起動 API を公開しない
- 子プロセス（child_process）で実行エンジンを起動し、子プロセス側で vm2 により生成コードを実行する
- macOS 専用前提
- Node v22 前提
- ブラウザ起動挙動はユーザー設定（able.playwrightRepl.*）で制御可能
- 既存 able_run_in_sandbox と同等に、安全側デフォルトで運用する

## 2. 非目標

- 汎用 js_repl ツールの再実装
- LLM から任意の Playwright 起動オプションを直接受け取る API
- Linux / Windows 対応
- 既存 able_fetch_webpage の置き換え

## 3. 再調査サマリー（見落とし候補）

js_repl ドキュメント、Playwright Interactive SKILL、Node vm ドキュメントから、初版計画で不足していた観点を整理した。

### 3.1 js_repl ドキュメント由来の見落とし

- top level await を前提にした使用感
  - Playwright 操作は await が前提であり、毎回 async IIFE を書かせる設計は運用性を大きく下げる
- カーネル永続時の失敗セル挙動
  - 失敗後にどの状態を維持するかを明文化しないと、再現性が下がる
- 実行ごとのタイムアウト上書き
  - js_repl には pragma で timeout 上書きがある。Playwright REPL でも安全な範囲で上書きを検討する余地がある
- モジュール解決戦略
  - どの import/require を許可するか（bare specifier、ローカルファイル）を明文化する必要がある
- 画像の扱い
  - js_repl 側は codex.emitImage で画像を外部に明示出力できる。Playwright REPL 側も screenshot の返却を LanguageModelDataPart 前提で設計しないと活用しづらい

### 3.2 Playwright Interactive SKILL 由来の見落とし

- スクリーンショットの正規化
  - macOS Retina 環境で viewport:null のとき、scale: "css" 指定でも実ピクセルになる場合がある
  - クリック座標に再利用する用途では CSS ピクセル正規化が重要
- JPEG 85 をデフォルトとする運用
  - トークン量と転送量を抑える方針を明記すべき
- クリップ撮影時の座標補正
  - clip 原点を戻す規約がないと、画像解析結果をそのままクリックに使えない
- Web と Electron の差
  - 本タスクは Web 前提だが、将来拡張を見据えて「Electron は別経路で正規化が必要」という制約をメモしておく価値がある

### 3.3 Node vm ドキュメント由来の見落とし

- vm はセキュリティ機構ではない
  - 子プロセス分離を主防御とする方針は妥当。vm2 も補助層として扱うべき
- timeout は万能ではない
  - 無限ループや大量出力時の資源消費を OS プロセス kill で止める設計が必要

## 4. top level await は必要か

結論: 必須に近い。採用する。

理由:

- Playwright の主操作が Promise ベースであり、毎回ラップを要求すると操作の反復速度が落ちる
- SKILL の実行例は await 前提の対話ループで構成されている
- セッション維持ツールの価値は短い反復にあり、記法の摩擦は最小化すべき

仕様:

- able_playwright_repl は top level await を受け付ける
- 実装は子プロセス側でコードを async 関数ラップして評価する
- 既存の永続状態（pw、内部ハンドル）は exec 間で保持する
- 失敗時は「初期化済みハンドルは保持、当該 exec の途中副作用はベストエフォートで残る」を明示する

注意点:

- js_repl のような失敗セルに対する厳密な hoist 回復は今回のスコープ外
- その代わり、予測可能な最小ルールをドキュメント化する

## 5. screenshot 機能の調査結果と方針

### 5.1 要件結論

- screenshot は初期フェーズから実装対象に含める
- 返却はテキストだけでなく画像データを扱える形を優先する
- 座標利用を想定し、CSS ピクセル基準のメタデータを返す

### 5.2 返却インターフェース

pw.screenshot(options?) の返却:

- image: LanguageModelDataPart 相当（mimeType + bytes）
- meta: JSON 文字列（width, height, cssWidth, cssHeight, deviceScaleFactor, clipped, clipRect）
- text: 補足（撮影対象、URL、時刻）

最初の段階では JPEG をデフォルト（quality 85）。

- 透過が必要な場合のみ PNG を許可
- 最大バイト数を設定で制限し、超過時はエラー

### 5.3 CSS 正規化ルール

- viewport 指定コンテキストでは page.screenshot({ scale: "css" }) を第一選択
- native-window（viewport:null）で期待寸法と不一致なら、子プロセス内で画像リサイズして CSS 相当に正規化
- clip 指定時は返却メタに clipRect を必ず含める

### 5.4 安全性

- screenshot は現在表示中ページのみ許可
- 任意パス書き出しは初期実装では禁止（メモリ返却のみ）
- 連続撮影レートを簡易制限（例: 1 exec あたり最大 3 枚）

## 6. 全体アーキテクチャ

### 6.1 親プロセス（拡張側）

新規ツール PlaywrightReplTool を追加し、子プロセス管理・I/O 中継・セッション管理を行う。

責務:

1. 入力検証（空文字、サイズ上限）
2. セッション単位で子プロセスを作成・再利用
3. NDJSON で子プロセスに実行要求
4. タイムアウト時の強制終了
5. LanguageModelToolResult を text と data の混在で整形

### 6.2 子プロセス（実行エンジン）

src/playwright_repl/playwrightrunner.ts を Node プロセスとして起動。

責務:

1. vm2 NodeVM 初期化
2. top level await 対応でコード評価
3. playwright API を直接公開せず、内部保持 browser/context/page を pw ヘルパー経由で公開
4. console 出力、戻り値、例外、画像を JSON で返却
5. reset/dispose で page/context/browser を確実に close

### 6.3 公開ヘルパー API（最小）

- pw.goto(url)
- pw.click(selector)
- pw.fill(selector, value)
- pw.text(selector)
- pw.locator(selector).click()
- pw.getByRole(role, options)
- pw.screenshot(options?)

初期版では API 面積を増やしすぎない。

## 7. セッション管理

### 7.1 基本

- Map<sessionKey, ChildSession> を PlaywrightReplTool 内に保持
- sessionKey は chatSessionResource / chatSessionId を優先
- 取れない場合は default

### 7.2 reset

- able_playwright_repl_reset は該当セッションの子プロセスを破棄して再生成
- 5 分アイドルで自動破棄

## 8. 通信プロトコル（NDJSON）

親 -> 子:

{"id":"1","type":"exec","code":"await pw.goto('https://example.com')"}
{"id":"2","type":"reset"}
{"id":"3","type":"dispose"}

子 -> 親:

{"id":"1","ok":true,"stdout":"...","stderr":"...","result":"...","images":[...]}
{"id":"1","ok":false,"stdout":"...","stderr":"...","error":{"name":"Error","message":"...","stack":"..."}}

## 9. 設定設計（package.json contributes.configuration）

- able.playwrightRepl.browserType: chromium | firefox | webkit（default: chromium）
- able.playwrightRepl.headless: boolean（default: true）
- able.playwrightRepl.network.allow: boolean（default: false）
- able.playwrightRepl.network.allowedHosts: string[]（default: []）
- able.playwrightRepl.timeoutMs: number（default: 15000）
- able.playwrightRepl.maxOutputBytes: number（default: 16384）
- able.playwrightRepl.maxScreenshotBytes: number（default: 1048576）
- able.playwrightRepl.screenshotDefaultFormat: jpeg | png（default: jpeg）

## 10. セキュリティ方針

1. 主防御は別プロセス化
2. vm2 は第二防御層
3. NodeVM.require は allowlist
   - builtin: path, url, buffer
   - external: playwright のみ
4. child_process, worker_threads, fs, net, tls, http/https などは禁止
5. ネットワークはデフォルト拒否
   - URL 検査 + page.route による allowlist 制御
6. タイムアウト時にプロセス kill
7. stdout/stderr 各 16KB 上限
8. screenshot バイト上限とレート制限

## 11. 実装タスク分解（改訂）

### 追補タスク（2026-03-17 追加）: validator 改修とテスト強化

1. src/playwright_repl/codevalidator.ts から正規表現ベース禁止判定を除去
2. tree-sitter の AST ノード解析のみで禁止判定を実装
  - import 文
  - import() 呼び出し
  - require() 呼び出し
  - process / globalThis.process 参照
3. テストを拡張し、文字列リテラル誤検知が発生しないことを確認
4. runner のテストを URL 許可判定・host 正規化に加え message parse 周辺まで追加

### フェーズ 1: 骨格

1. src/playwright_repl/playwrightrepltool.ts 新規
2. src/playwright_repl/playwrightrunner.ts 新規
3. src/main.ts に 2 ツール登録
4. package.json に 2 ツール定義
5. package.json に設定項目追加

### フェーズ 2: 実行基盤

1. 親側 child_process 起動・再利用
2. NDJSON 通信
3. タイムアウト・キャンセル kill
4. reset 実装
5. top level await 対応評価

### フェーズ 3: Playwright ラッパー

1. 子側で browser/context/page ライフサイクル管理
2. pw 最小 API 実装
3. headless/browserType 反映
4. network deny by default

### フェーズ 4: screenshot

1. pw.screenshot 実装（jpeg/png）
2. CSS 正規化
3. LanguageModelDataPart 返却
4. clipRect 含むメタ返却
5. バイト上限・レート制限

### フェーズ 5: 制約強化

1. vm2 allowlist 制御
2. tree-sitter で実行前 validation
3. 禁止 API の fail-fast
4. エラー文言をユーザー理解しやすく整形

### フェーズ 6: テスト

1. セッション継続
2. reset 後初期化
3. タイムアウト
4. 禁止 API アクセス拒否
5. ネットワーク拒否
6. top level await 実行
7. screenshot 返却（画像 + メタ）
8. native-window での寸法正規化

## 12. 影響ファイル（予定）

- src/main.ts
- src/playwright_repl/playwrightrepltool.ts（新規）
- src/playwright_repl/playwrightrunner.ts（新規）
- package.json
- 必要なら src/chat/prompt.tsx またはツール案内文
- test/unittest/playwright_repl/*.ts（新規）

## 13. リスクと対策

- vm2 単体の過信
  - 対策: 子プロセス分離を主防御に固定
- top level await 実装差異
  - 対策: 失敗時状態ルールを明文化し、挙動テストを追加
- screenshot サイズ増大
  - 対策: jpeg デフォルト、品質固定、上限超過時エラー
- macOS Retina 由来の座標ずれ
  - 対策: CSS 正規化メタを返却し、クリック時に clip 原点補正
- セッション識別子取得の不確実性
  - 対策: chatSessionResource 優先 + default フォールバック

## 14. 実装順序（最短）

1. tool contribution + register
2. child_process + echo runner
3. vm2 で top level await 評価
4. Playwright 管理ラッパー導入
5. screenshot（画像返却 + 正規化）
6. ネットワーク制限 + reset
7. テスト追加

## 15. 追補タスク（2026-03-17）: constructor アクセス遮断

### 背景

- vm2 の既知攻撃では `.constructor` 参照がエスケープ連鎖の起点になりやすい
- 現在の validator は `import/require/process` 重点で、constructor 系を未遮断

### 今回の要求

1. [src/playwright_repl/codevalidator.ts](src/playwright_repl/codevalidator.ts) で `.constructor` 参照を禁止する
2. ドット、optional chaining、ブラケット（`['constructor']`）をすべて禁止する
3. 文字列リテラル・コメント中の語句は誤検知しない
4. [contexttmp/vm2/docs/ATTACKS.md](contexttmp/vm2/docs/ATTACKS.md) を参照し、追加で禁止すべき高リスクパターンを調査し反映する

### 追加で優先検討する遮断候補

- `__proto__` 参照
- `Object.setPrototypeOf` / `Reflect.setPrototypeOf`
- `__defineGetter__` / `__defineSetter__` / `__lookupGetter__` / `__lookupSetter__`
- `Symbol.species` / `Symbol.hasInstance` 参照

### 受け入れ条件

- constructor 参照の 3 パターンが unit test で拒否される
- 既存の許可ケース（通常 await、文字列中語句）は維持される
- validator は引き続き tree-sitter AST 判定のみを利用する
