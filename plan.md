# TypeScript + Node.js で js_repl 相当を実装するための計画

## 目的
- 永続セッション型の JavaScript 実行環境を提供する。
- top-level await を許可する。
- 実行環境を安全に制限する。
- 将来的にブラウザ自動化（例: Playwright）と連携できる構成にする。

## ゴール定義
- 1回目の実装で達成する範囲:
  - Node 子プロセスで常駐カーネルを動かす。
  - JSON Lines プロトコルで Host と Kernel が通信する。
  - セル間でトップレベル変数を持続させる。
  - 実行タイムアウトとリセット機能を持つ。
  - 最低限のモジュール import 制御と危険 API 制限を持つ。
- 後続フェーズで拡張する範囲:
  - Host 側の汎用ツール呼び出しブリッジ。
  - 画像出力ブリッジ（スクリーンショット共有など）。
  - プラットフォーム別 OS サンドボックス強化。

## 全体アーキテクチャ
- Host プロセス（TypeScript）
  - カーネル起動・監視
  - リクエスト管理（exec_id 単位）
  - タイムアウト管理
  - ツール呼び出しディスパッチ
- Kernel プロセス（Node.js）
  - vm.SourceTextModule ベースでセル実行
  - セル間状態保持
  - 動的 import 解決
  - Host への run_tool / emit_image 要求
- 通信方式
  - stdin/stdout の JSON Lines
  - メッセージ種別: exec / exec_result / run_tool / run_tool_result / emit_image / emit_image_result

## フェーズ別計画

### Phase 0: 要件固定（0.5日）
- 実行対象 Node の最小バージョンを決める（例: 22.x）。
- 非機能要件を決める。
  - セル実行上限時間
  - 1セルあたり出力上限
  - 同時実行数
- セキュリティ方針を決める。
  - 禁止組み込みモジュール
  - ネットワーク可否
  - ファイルアクセス可否
- 成果物:
  - requirements.md
  - threat-model.md

### Phase 1: 最小カーネル起動（1日）
- Host から Node 子プロセスを起動する。
- kernel.js（または kernel.mjs）を一時ディレクトリへ配置して起動する。
- JSON Lines で疎通確認する（echo レベル）。
- 異常終了監視と自動再起動方針を入れる。
- 完了条件:
  - exec を送ると固定の exec_result が返る。
  - カーネル異常終了を Host が検知できる。

### Phase 2: 実行エンジン（2日）
- vm.createContext を作り、SourceTextModule でセルを実行する。
- top-level await を実現する。
- セル間状態の持続戦略を実装する。
  - 前回セルの公開バインディングを次セルに再導入
- console 出力のキャプチャを実装する。
- タイムアウト実装:
  - Host 側 timeout
  - timeout 時にカーネル再起動
- 完了条件:
  - 連続セルで変数が再利用できる。
  - エラー時に既存状態が壊れない。

### Phase 3: import 制御（1.5日）
- 解決順序を設計する。
  - 環境変数で指定した module roots
  - 設定ファイルの module roots
  - 実行作業ディレクトリ
- 動的 import を実装する。
- ローカルファイル import を制限する。
  - .js/.mjs のみ許可
  - ディレクトリ import 禁止
- 危険組み込みモジュール禁止を実装する。
  - process
  - child_process
  - worker_threads
- 完了条件:
  - 許可ケースは読み込める。
  - 禁止ケースは明確なエラーになる。

### Phase 4: ツールブリッジ（2日）
- Kernel のグローバルに helper API を注入する。
  - repl.tool(name, args)
  - repl.cwd / repl.homeDir / repl.tmpDir
- run_tool メッセージ往復を実装する。
- 再帰防止を入れる。
  - 内部ツール自身を tool() で呼べないようにする
- ログ設計:
  - info で要約
  - trace で生データ
- 完了条件:
  - JS 内から Host の任意ツールが呼べる。
  - 失敗時エラーが JavaScript 側に伝播する。

### Phase 5: 画像ブリッジ（1日）
- repl.emitImage(imageLike) を実装する。
- 受理形式を定義する。
  - data URL
  - bytes + mimeType
  - ツール出力オブジェクト（画像1件のみ）
- 混在制限を実装する。
  - テキスト + 画像混在は拒否
- 完了条件:
  - JS 側で emitImage を呼ぶと Host の最終出力へ画像が載る。

### Phase 6: sandbox 強化（2日）
- まずは Node プロセス環境を最小化する。
  - 環境変数ホワイトリスト
  - 作業ディレクトリ固定
- OS サンドボックスを段階導入する。
  - macOS: seatbelt
  - Linux: seccomp/landlock 系ラッパー
  - Windows: restricted token
- ネットワーク制限時の明示フラグを子プロセスへ渡す。
- 完了条件:
  - ポリシー別に許可/拒否が再現性を持って動く。

### Phase 7: Playwright 連携（1日）
- 専用統合ではなく、汎用ツール連携として実装する。
- 2経路をサポートする。
  - カーネル内で playwright を import して直接利用
  - Host 側 Playwright ツールを repl.tool() で呼び出し
- スクリーンショット共有を標準化する。
  - page.screenshot() の bytes を emitImage へ渡す
- 完了条件:
  - ブラウザ操作結果をテキストと画像で返せる。

### Phase 8: テストと安定化（2日）
- 単体テスト
  - import 解決
  - 禁止モジュール
  - タイムアウト
- 結合テスト
  - 連続セル状態保持
  - run_tool 往復
  - emitImage 往復
- 障害テスト
  - カーネルクラッシュ
  - 壊れた JSON 行
  - 標準出力の不正書き込み
- 完了条件:
  - 主要フローと異常系が自動テストで担保される。

## 推奨ディレクトリ構成
```text
project/
  src/
    host/
      JsReplManager.ts
      KernelProcess.ts
      MessageProtocol.ts
      ToolBridge.ts
      SandboxPolicy.ts
    kernel/
      kernel.mjs
      moduleResolver.mjs
      stateCarryover.mjs
      emitImage.mjs
  test/
    unit/
    integration/
  docs/
    requirements.md
    protocol.md
    sandbox.md
```

## メッセージプロトコル案（最小）
- Host -> Kernel
  - exec: { type, id, code, timeoutMs }
  - run_tool_result: { type, id, ok, response, error }
  - emit_image_result: { type, id, ok, error }
- Kernel -> Host
  - exec_result: { type, id, ok, output, error }
  - run_tool: { type, id, execId, toolName, arguments }
  - emit_image: { type, id, execId, imageUrl, detail }

## セキュリティチェックリスト
- process グローバル非公開
- child_process import 拒否
- worker_threads import 拒否
- stdin/stdout へユーザーコードが直接書かないよう注意喚起
- リクエストごとの最大サイズ制限
- stderr tail を保持して障害解析可能にする

## 最初の2週間スケジュール例
- Week 1
  - Day 1: Phase 0
  - Day 2: Phase 1
  - Day 3-4: Phase 2
  - Day 5: Phase 3
- Week 2
  - Day 1-2: Phase 4
  - Day 3: Phase 5
  - Day 4: Phase 6
  - Day 5: Phase 7 + Phase 8 着手

## 主要リスクと対策
- リスク: VM の状態持続仕様が複雑
  - 対策: まず「成功セルのみ状態反映」で開始し、失敗セルの部分反映は後段で導入
- リスク: モジュール解決が環境差で不安定
  - 対策: roots を明示設定し、暗黙の親探索を禁止
- リスク: サンドボックス差異（OS依存）
  - 対策: 共通インターフェースを定義し、OS別実装を差し替え
- リスク: 画像出力の形式揺れ
  - 対策: 受理形式を厳格化し、バリデーション失敗を明示

## 実装開始時の最小タスク
1. MessageProtocol.ts を作る（型定義と JSON schema）。
2. KernelProcess.ts で Node 起動・入出力処理を作る。
3. kernel.mjs で exec -> exec_result の最小往復を作る。
4. 連続セル状態保持を入れる。
5. timeout と reset を入れる。
6. import 制限を入れる。
7. tool ブリッジを入れる。
8. emitImage を入れる。
