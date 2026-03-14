# Playwright REPL 実装計画（Seatbelt 非採用 / Node v22 / macOS 前提）

## 1. 目的
- OpenAI Codex CLI の js_repl をそのまま移植せず、Playwright 専用 REPL を実装する
- LLM がブラウザ起動 API を直接呼べない構造を維持する
- macOS + Node v22 前提で、安全性を Seatbelt 以外の手段で強化する
- Playwright REPL で import / require / eval を禁止する

## 2. 変更後の前提（確定）
- seatbelt は使用しない
- プラットフォームは macOS のみ想定
- Node は v22 系を前提（22.22.0 以上を推奨）
- browser の起動条件はユーザー設定のみで制御
- LLM には browser launch API を公開しない
- tree-sitter は利用可能（実装参考: src/lmtools/runinsandboxlib/commandparser.ts）

## 3. アーキテクチャ方針

### 3.1 機能の切り分け
- ツール公開は以下のみ
  - playwrightrepl_exec
  - playwrightrepl_reset
- 非公開
  - browser launch / close API
  - 任意ツール呼び出し API

### 3.2 実行モデル
- Host（TypeScript）
  - Playwright BrowserContext / Page のライフサイクルを管理
  - Kernel プロセスを起動・監視
  - REPL 入力の静的検査（tree-sitter）を実施
- Kernel（Node）
  - 許可済みコードのみ実行
  - セル間状態を保持
  - 出力を JSON Lines で Host に返却

## 4. Seatbelt を使わない防御設計

### 4.1 防御の主軸
- 防御 1: 入力コードの構文レベル拒否（tree-sitter）
- 防御 2: 実行環境の能力最小化（VM context と global 制限）
- 防御 3: プロセス分離と強制リセット（timeout / crash 時 kill）
- 防御 4: I/O とプロトコル制限（サイズ・時間・回数制限）

### 4.2 具体的な強化項目
- Kernel は専用子プロセスで実行（1 セッション 1 プロセス）
- timeout 時は即 kill して新規プロセスで再初期化
- 環境変数はホワイトリストで注入
- cwd は固定（ユーザー設定から決定、実行中変更不可）
- stdout/stderr の直接利用を禁止し protocol 汚染を防止
- 1 実行あたりの入力・出力サイズ上限
- 1 実行あたりの最大実行時間

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
- global から require / process / module / Buffer を非公開
- import を許可しない linker を使用
- 文字列評価系 API をラップして拒否
- Host 注入オブジェクトを freeze して書き換え耐性を上げる

## 8. ブラウザ起動のユーザー設定固定

### 8.1 設定項目
- playwrightrepl.runtime.browser
- playwrightrepl.runtime.channel
- playwrightrepl.runtime.headless
- playwrightrepl.runtime.executablepath
- playwrightrepl.runtime.launchoptions
- playwrightrepl.runtime.contextoptions
- playwrightrepl.runtime.networkpolicy

### 8.2 制御ルール
- 起動設定の解決は Host のみ
- LLM 実行中に起動設定を変更不可
- 設定変更は reset 後に反映

## 9. フェーズ計画

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

### Phase 2: tree-sitter ガード実装（1.5 日）
- JavaScript parser 初期化
- 禁止ルール query 実装
- 拒否レスポンス整備
- Exit 条件
  - 禁止文法が実行前に全て拒否される

### Phase 3: ランタイム能力制限（1.5 日）
- vm context 制約
- global 制約
- linker で import 拒否
- Exit 条件
  - tree-sitter 回避入力でも実行時に拒否される

### Phase 4: Playwright 固定ハンドル統合（1.5 日）
- Host で BrowserContext / Page 管理
- Kernel へ pw.page / pw.context / pw.helpers 注入
- reset 時の再生成
- Exit 条件
  - セル跨ぎで page を再利用できる

### Phase 5: 出力制御とエラー分類（1 日）
- ログ・出力の上限
- エラー分類
  - syntax_guard
  - runtime_guard
  - playwright_runtime
  - infrastructure
- Exit 条件
  - 失敗原因の切り分けが可能

### Phase 6: テスト（2 日）
- 単体
  - tree-sitter ルール検出
  - parser 初期化失敗時ハンドリング
  - timeout リカバリ
- 結合
  - page 永続化
  - reset 再初期化
- セキュリティ回帰
  - import / require / eval を拒否
  - new Function を拒否
  - protocol 汚染入力を拒否
- Exit 条件
  - 主要経路と禁止仕様が自動テストで担保

## 10. 非目標
- seatbelt を使ったサンドボックス再導入
- 汎用 js_repl 化
- Linux / Windows 対応
- 任意 npm パッケージ import 許可

## 11. リスクと対策
- リスク: AST ルール漏れ
  - 対策: runtime 制約を併用し二重化
- リスク: parser 初期化失敗で guard が無効化
  - 対策: fail-closed（検査不能なら実行拒否）
- リスク: 長時間タスクでセッションが不安定
  - 対策: 短時間セル指向 + timeout + 自動再起動

## 12. 受け入れ条件
- seatbelt を利用しない
- Playwright REPL で import / require / eval が実行不能
- LLM が browser launch API を直接呼べない
- ユーザー設定でのみ browser 起動条件を制御可能
- macOS + Node v22 で継続実行と reset が機能

## 13. 直近の着手順
1. tree-sitter JavaScript parser モジュール追加
2. banned syntax query 実装
3. playwrightrepl_exec に事前検査フック追加
4. vm runtime ガード追加
5. Playwright 固定ハンドル注入
6. 禁止仕様テスト追加
