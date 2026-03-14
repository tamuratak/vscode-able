# Playwright 専用 REPL 実装計画（Node v22 / macOS 前提）

## 1. この計画の目的
- OpenAI Codex CLI の js_repl の設計を参考にしつつ、同等機能をそのまま移植せず、Playwright 専用の実行機構として再設計する
- LLM が任意にブラウザを起動できない構造を維持しながら、ページ操作と観測を継続可能な REPL 体験を実現する
- Node v22 上で「VM 単体はセキュリティ境界にならない」前提で、安全性を多層化する

## 2. 追加要件を反映した前提
- 対象プラットフォームは macOS のみ
- Node は v22 系を前提（最低要件は 22.22.0 相当を推奨）
- Playwright 専用機能とし、汎用 js_repl にはしない
- ブラウザ起動設定はユーザーが設定で管理する
- LLM には browser launch API を tool call として公開しない
- Webview runtime は代替案として比較検討する

## 3. 既存調査の要点（実装判断に使う事実）
- 既存 codex の js_repl は Node 子プロセス + vm.SourceTextModule + JSON Lines プロトコル構成
- Node の vm は公式に「セキュリティ機構ではない」と明記
- 既存 codex でも VM 制約に加えて OS sandbox を併用する設計
- Playwright は既存 js_repl の専用機能ではなく、補助 API とツール連携で扱っている

## 4. 方針決定

### 4.1 機能の切り分け
- 新機能名は仮に playwrightrepl とする
- 公開ツールは以下のみ
  - playwrightrepl_exec
  - playwrightrepl_reset
- 直接公開しないもの
  - browser launch
  - browser close
  - 任意ツール実行の汎用 API

### 4.2 実行モデル
- Host（TypeScript）
  - Node 子プロセス（Kernel）を起動
  - ユーザー設定から Playwright launch options を読み込む
  - Browser/Context/Page を事前作成し、Kernel へは「既に起動済みページ」だけを提供
- Kernel（Node）
  - セル実行（top-level await 対応）
  - 永続状態（page, context, 軽量ユーティリティ）
  - JS 実行結果を Host へ返却

### 4.3 Playwright 専用化の具体策
- Kernel には playwright モジュール自体を露出しない
- 代わりに Host が注入する固定オブジェクトのみ使用可能
  - pw.page
  - pw.context
  - pw.helpers（安全なラッパーのみ）
- import 制御で以下を禁止
  - node:child_process
  - node:worker_threads
  - node:inspector
  - playwright（再起動や別ブラウザ生成を防止）

## 5. セキュリティ設計（Node runtime を本当に安全化する）

### 5.1 設計原則
- VM は隔離の補助であり、境界はプロセスと OS 側で作る
- 1 セッション = 1 Kernel プロセス
- Timeout 発生時はプロセス破棄し、状態を再構築

### 5.2 多層防御
- 第1層: プロトコル制約
  - JSON Lines の厳格パース
  - 入出力サイズ上限
  - 実行時間上限
- 第2層: VM 制約
  - contextCodeGeneration.strings を false
  - contextCodeGeneration.wasm を false
  - process, require, Buffer など危険グローバル非公開
- 第3層: Node プロセス制約
  - --experimental-vm-modules 以外の不要フラグ禁止
  - env ホワイトリスト
  - cwd 固定
  - stdio プロトコル保護（任意書き込み抑止）
- 第4層: macOS サンドボックス
  - seatbelt プロファイル適用
  - デフォルト deny、必要最小限のみ許可

### 5.3 macOS ポリシー草案
- 許可
  - Playwright 実行に必要なブラウザプロセス生成
  - ユーザー指定ディレクトリ配下の限定読み取り
  - 一時ディレクトリ配下への書き込み
- 禁止
  - 任意の追加プロセス生成
  - 未許可ディレクトリへの書き込み
  - 設定で許可されていない外部通信

## 6. ブラウザ起動の「ユーザー設定のみ」設計

### 6.1 設定項目（例）
- playwrightrepl.runtime.browser
- playwrightrepl.runtime.channel
- playwrightrepl.runtime.headless
- playwrightrepl.runtime.executablepath
- playwrightrepl.runtime.launchoptions
- playwrightrepl.runtime.contextoptions
- playwrightrepl.runtime.networkpolicy

### 6.2 制御ルール
- 起動設定の解決は Host だけが行う
- LLM からは起動設定を変更できない
- 実行中に設定変更があっても、次回 reset まで反映しない

## 7. Webview runtime 代替案の評価

### 7.1 Node runtime 案（本線）
- 長所
  - Playwright 連携が素直
  - 既存 js_repl の知見を活用しやすい
- 短所
  - サンドボックスを OS で補う必要がある

### 7.2 Webview runtime 案（代替）
- 長所
  - VS Code 側の分離モデルを利用しやすい
- 短所
  - Playwright 実行主体との境界が複雑
  - Node API と同等の制御を再構築しにくい

### 7.3 結論
- Phase 1 は Node runtime を採用
- Webview は「監視 UI と可視化」に限定して別トラックで検証

## 8. 実装フェーズ

### Phase 0: 要件凍結と脅威分析（0.5 日）
- assets
  - requirements.md
  - threatmodel.md
  - sandboxpolicy.md
- Exit 条件
  - 攻撃面（RCE, FS, Network, Protocol 汚染）への対策が定義済み

### Phase 1: 最小 Host/Kernel 疎通（1 日）
- Node v22 互換確認
- Kernel 起動/終了/再起動
- exec -> exec_result 往復
- Exit 条件
  - 最小コード実行が安定

### Phase 2: Playwright セッション固定化（1.5 日）
- Host で BrowserContext/Page 生成
- Kernel へ固定ハンドル注入
- reset で安全に再作成
- Exit 条件
  - セル跨ぎで page が再利用される

### Phase 3: 安全化レイヤー実装（2 日）
- import 制限
- VM 制約
- Timeout + kill + clean restart
- env/cwd/stdout 制約
- Exit 条件
  - 主要逸脱ケースが拒否される

### Phase 4: macOS sandbox 適用（2 日）
- seatbelt プロファイル作成
- ローカルファイル/通信/子プロセス制御
- Playwright 必須権限の最小化調整
- Exit 条件
  - E2E で Playwright が動作し、不要権限は拒否

### Phase 5: 出力モデル整備（1 日）
- テキストログ整形
- スクリーンショット返却形式統一（jpeg/png）
- エラー分類（ユーザーコード/制約違反/実行基盤）
- Exit 条件
  - 失敗時の原因が判別可能

### Phase 6: テストと運用ガード（2 日）
- 単体
  - 設定解決
  - import 制限
  - timeout
- 結合
  - ページ状態持続
  - reset 後再初期化
- 逸脱
  - 禁止モジュール import
  - stdout 汚染
  - 過大出力
- Exit 条件
  - 主要経路が自動テスト化

## 9. 提供インターフェース（初版）
- playwrightrepl_exec
  - 入力: 生の JavaScript（freeform）
  - 出力: text + optional image
- playwrightrepl_reset
  - セッション破棄と再初期化

## 10. 非目標（初版でやらないこと）
- 汎用 js_repl 化
- LLM からの browser launch API 呼び出し
- クロスプラットフォーム対応（Linux/Windows）
- 任意 npm パッケージの自由 import

## 11. リスクと対策
- リスク: VM 依存の安全化の過信
  - 対策: OS sandbox とプロセス隔離を主境界にする
- リスク: Playwright 実行に必要な権限が過大化
  - 対策: deny-by-default で許可を段階追加
- リスク: ユーザー設定と実行時状態の不一致
  - 対策: 設定スナップショットをセッション開始時に固定

## 12. 受け入れ条件
- LLM が browser launch API を直接呼べない
- ユーザー設定のみでブラウザ起動条件を制御できる
- Node v22 + macOS で安定動作する
- 主要な逸脱行為が拒否される
- Playwright 操作の継続実行と reset が機能する

## 13. 直近の実装順（着手タスク）
1. 設定スキーマ定義（runtime/launch/context/network）
2. Host 側セッションマネージャ作成
3. Kernel 最小実装（exec/reset）
4. Playwright 固定オブジェクト注入
5. import/VM 制限実装
6. macOS sandbox 接続
7. 結合テスト整備
