# Playwright REPL 実装計画（Seatbelt 非採用 / Node v22 / macOS 前提）

## 0. 文書運用ルール
- 本実装中は plan.md を静的マスターとして扱う
- planexec.md を living doc として扱い、タスク開始/完了のたびに更新する
- 実装コードは src/playwright_repl 以下に配置する
- テストコードは test/unittest/playwright_repl 以下に配置する
- able_run_in_sandbox ツールでは Playwright を実行できないため、実機確認が必要な場合は vscode_askQuestions でユーザーに実行依頼する

## 1. 目的
- OpenAI Codex CLI の js_repl をそのまま移植せず、Playwright 専用 REPL を実装する
- LLM がブラウザ起動 API を直接呼べない構造を維持する
- macOS + Node v22 前提で、accidental misuse 防止レベルの安全性を Seatbelt 以外の手段で強化する
- Playwright REPL で import / require / eval を禁止する
- 将来拡張を前提にせず、Playwright 以外の helper 追加を許可しない
- Playwright API 呼び出しのため top-level await を必須でサポートする

## 2. 変更後の前提（確定）
- seatbelt は使用しない
- プラットフォームは macOS のみ想定
- Node は v22 系を前提（22.22.0 以上を推奨）
- browser の起動条件はユーザー設定のみで制御
- LLM には browser launch API を公開しない
- tree-sitter は利用可能（実装参考: src/lmtools/runinsandboxlib/commandparser.ts）
- vm は強固なセキュリティ境界ではない前提で利用する（誤用防止用途）
- Playwright 以外の helper/API 注入は行わない
- 対象スコープは Web の Playwright のみ（Electron は対象外）

## 3. アーキテクチャ方針

### 3.1 機能の切り分け
- ツール公開は以下のみ
  - playwrightrepl_exec
  - playwrightrepl_reset
- 非公開
  - browser launch / close API
  - 任意ツール呼び出し API
  - Playwright 以外の helper/API

### 3.3 利用条件
- feature gate が有効な場合のみツール公開する
- 直接ツール呼び出しは playwrightrepl_exec / playwrightrepl_reset に限定する

### 3.2 実行モデル
- Host（TypeScript）
  - Playwright BrowserContext / Page のライフサイクルを管理
  - Kernel プロセスを起動・監視
  - REPL 入力の静的検査（tree-sitter）を実施
  - 設定の解決・反映（able.playwrightrepl.runtime.*）を一元管理
- Kernel（Node）
  - 許可済みコードのみ実行（誤用防止向け能力制限）
  - セル間状態を保持
  - 出力を JSON Lines で Host に返却

## 4. Seatbelt を使わない防御設計

### 4.1 防御の主軸
- 防御 1: 入力コードの構文レベル拒否（tree-sitter）
- 防御 2: 実行環境の能力最小化（VM context と global 制限）
- 防御 3: プロセス分離と強制リセット（timeout / crash 時 kill）
- 防御 4: I/O とプロトコル制限（サイズ・時間・回数制限）

注記:
- 本設計は accidental misuse 防止を目的とする
- vm を単独のセキュリティ境界として扱わない

### 4.2 具体的な強化項目
- Kernel は専用子プロセスで実行（1 セッション 1 プロセス）
- timeout 時は即 kill して新規プロセスで再初期化
- 環境変数はホワイトリストで注入
- cwd は固定（ユーザー設定から決定、実行中変更不可）
- stdout/stderr の直接利用を禁止し protocol 汚染を防止
- 1 実行あたりの入力・出力サイズ上限
- 1 実行あたりの最大実行時間
- timeout は vm 実行オプションとプロセス kill の二重化で扱う
- microtask の timeout すり抜け対策として context 作成時に microtaskMode を afterEvaluate に設定する
- queueMicrotask / process.nextTick / setTimeout / setImmediate は Kernel に注入しない
- 実行オプションとして先頭行 pragma による timeout 上書きを限定的に許可する

## 5. Playwright REPL の禁止仕様（重要）

### 5.1 禁止対象
- import 宣言（static import）
- import()（dynamic import）
- import.meta
- require(...) 呼び出し
- eval(...) 呼び出し

### 5.2 追加で禁止する推奨対象
- new Function(...)
- setTimeout / setInterval に文字列を渡す形式
- node:module などモジュール解決を経由する経路

### 5.3 例外方針
- 例外は設けない（初版）
- 必要機能は Host 注入 API（pw.page, pw.context, pw.helpers）で提供
- 必要機能は Playwright 操作に限定し、将来拡張用 helper は追加しない

### 5.4 top-level await 仕様
- playwrightrepl_exec は top-level await を受け付ける
- 1 セル内で await を使った Playwright 操作をそのまま実行できる
- セル失敗時に既存の Playwright ハンドル（pw.page, pw.context）が壊れていなければ維持する

## 6. tree-sitter による事前検査設計

### 6.1 実装方針
- src/lmtools/runinsandboxlib/commandparser.ts の初期化方式を踏襲
  - wasm ローダー初期化
  - language ロード
  - query 実行
- 新規に JavaScript 用 parser モジュールを追加
- 実行前に AST を解析し、禁止ノードを検出したら実行拒否

### 6.2 検出ルール（初版）
- import_statement
- import_clause
- call_expression 内の import
- member_expression 内の import.meta
- call_expression で callee が require
- call_expression で callee が eval
- new_expression で constructor が Function
- call_expression で callee が setTimeout / setInterval かつ第一引数が文字列

注記:
- AST 検出は既知パターン拒否として扱う
- 未検出経路はランタイム制約で拒否する

### 6.3 返却エラー設計
- 構文拒否時は実行しない
- エラーは以下の情報を返す
  - rule_id
  - node_type
  - line / column
  - short_message

## 7. ランタイム制約（tree-sitter すり抜け対策）
- vm context で contextCodeGeneration.strings = false
- vm context で contextCodeGeneration.wasm = false
- vm context 作成時に microtaskMode = 'afterEvaluate' を指定
- global から require / process / module / Buffer を非公開
- import を許可しない linker を使用
- 文字列評価系 API をラップして拒否
- Host 注入オブジェクトを freeze して書き換え耐性を上げる
- outer context の関数/Promise を Kernel 側へ共有しない

## 8. ブラウザ起動のユーザー設定固定

### 8.1 設定項目
- able.playwrightrepl.runtime.browser
- able.playwrightrepl.runtime.channel
- able.playwrightrepl.runtime.headless
- able.playwrightrepl.runtime.executablePath
- able.playwrightrepl.runtime.launchOptions
- able.playwrightrepl.runtime.contextOptions
- able.playwrightrepl.runtime.networkPolicy

### 8.2 制御ルール
- 起動設定の解決は Host のみ
- LLM 実行中に起動設定を変更不可
- 設定変更は reset 後に反映
- 設定スキーマは extension の contributes.configuration で定義する
- playwrightrepl_reset は回復用操作として扱い、通常フローでの常用を前提にしない

## 9. screenshot 出力仕様（最小）
- 形式は image/jpeg と image/png をサポートする
- 1 実行で複数枚の screenshot を返せる
- 画像ごとに最大バイト数と 1 実行あたりの総量上限を設定する
- screenshot は Playwright の page.screenshot() 出力を受理対象とする

## 10. フェーズ計画

### Phase 0: 要件固定と禁止仕様定義（0.5 日）
- 成果物
  - requirements.md
  - threatmodel.md
  - bannedsyntax.md
- Exit 条件
  - import / require / eval 禁止仕様が合意済み

### Phase 1: 最小 REPL 疎通（1 日）
- Host-Kernel JSON Lines 疎通
- exec / reset 実装
- timeout + kill + restart
- Exit 条件
  - 安定して往復できる
  - top-level await の最小セルが成功する

### Phase 2: tree-sitter ガード実装（1.5 日）
- JavaScript parser 初期化
- 禁止ルール query 実装
- 拒否レスポンス整備
- Exit 条件
  - 既知の禁止文法パターンが実行前に拒否される

### Phase 3: ランタイム能力制限（1.5 日）
- vm context 制約
- global 制約
- linker で import 拒否
- Exit 条件
  - tree-sitter 未検出の主要回避入力が実行時に拒否される

### Phase 4: Playwright 固定ハンドル統合（1.5 日）
- Host で BrowserContext / Page 管理
- Kernel へ pw.page / pw.context / pw.helpers 注入
- reset 時の再生成
- Exit 条件
  - セル跨ぎで page を再利用できる
  - セル失敗後も有効なハンドルは再利用できる

### Phase 5: 出力制御とエラー分類（1 日）
- ログ・出力の上限
- screenshot（jpeg/png）出力とサイズ上限
- エラー分類
  - syntax_guard
  - runtime_guard
  - playwright_runtime
  - infrastructure
- Exit 条件
  - 失敗原因の切り分けが可能
  - stdio protocol 汚染を検知・隔離できる

### Phase 6: テスト（2 日）
- 単体
  - tree-sitter ルール検出
  - parser 初期化失敗時ハンドリング
  - timeout リカバリ
  - microtaskMode=afterEvaluate 前提の timeout 回帰
  - top-level await セル実行
- 結合
  - page 永続化
  - reset 再初期化
  - screenshot 複数枚返却
- セキュリティ回帰
  - import / require / eval を拒否
  - new Function を拒否
  - setTimeout("...") / setInterval("...") を拒否
  - protocol 汚染入力を拒否
- Exit 条件
  - 主要経路と既知の禁止仕様が自動テストで担保

## 11. 非目標
- seatbelt を使ったサンドボックス再導入
- 汎用 js_repl 化
- Linux / Windows 対応
- 任意 npm パッケージ import 許可
- Electron 向け Playwright 運用（_electron launch や BrowserWindow.capturePage）
- screenshot の CSS 正規化や座標再投影の高度機能

## 12. リスクと対策
- リスク: AST ルール漏れ
  - 対策: runtime 制約を併用し二重化
- リスク: parser 初期化失敗で guard が無効化
  - 対策: fail-closed（検査不能なら実行拒否）
- リスク: 長時間タスクでセッションが不安定
  - 対策: 短時間セル指向 + timeout + 自動再起動
- リスク: vm の仕様上、強固な分離を提供しない
  - 対策: accidental misuse 防止用途に限定し、OS サンドボックス相当の保証は非提供と明記
- リスク: microtask/非同期キュー経由の timeout すり抜け
  - 対策: afterEvaluate + 非同期スケジューラ非注入 + timeout 超過時のプロセス kill
- リスク: top-level await 非対応だと Playwright 操作が冗長化し運用ミスが増える
  - 対策: top-level await を必須要件化し初期フェーズで疎通テストを置く
- リスク: screenshot 出力が肥大化してプロトコルを圧迫する
  - 対策: 画像形式制限（jpeg/png）とサイズ上限を適用する

## 13. 受け入れ条件
- seatbelt を利用しない
- Playwright REPL で import / require / eval が実行不能
- LLM が browser launch API を直接呼べない
- ユーザー設定でのみ browser 起動条件を制御可能
- macOS + Node v22 で継続実行と reset が機能
- accidental misuse 防止レベルでの制約が動作し、強固なセキュリティ境界は提供しないことが文書化されている
- Playwright 以外の helper/API が追加されていない
- top-level await セルが実行できる
- screenshot を jpeg/png で返却でき、上限超過時に明示的エラーとなる
- 対象スコープが Web Playwright のみに限定されている

## 14. 直近の着手順
1. tree-sitter JavaScript parser モジュール追加
2. banned syntax query 実装
3. playwrightrepl_exec に事前検査フック追加
4. vm runtime ガード追加（afterEvaluate を含む）
5. Playwright 固定ハンドル注入
6. 設定スキーマ（able.playwrightrepl.runtime.*）追加
7. top-level await 疎通テスト追加
8. screenshot（jpeg/png, 複数枚, サイズ上限）テスト追加
9. 禁止仕様テスト追加
