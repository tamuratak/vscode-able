# Playwright REPL 実行計画（Living Doc）

この文書は実装の進行に合わせて動的に更新する。

## 運用ルール
- 静的マスターは plan.md とする
- この文書はタスク開始/完了のたびに更新する
- 実装コードは src/playwright_repl 以下に追加する
- テストコードは test/unittest/playwright_repl 以下に追加する
- able_run_in_sandbox では Playwright を実行できないため、実機確認が必要な場合は vscode_askQuestions でユーザーに実行依頼する

## 現在ステータス
- 全体進捗: 0%
- 現在フェーズ: Phase 0
- 現在タスク: 要件固定
- ブロッカー: なし
- 最終更新日: 2026-03-15

## フェーズ別チェックリスト

### Phase 0: 要件固定と禁止仕様定義
- [ ] requirements.md の要点を確定
- [ ] threatmodel.md の要点を確定
- [ ] bannedsyntax.md の要点を確定
- [ ] 既知禁止文法と runtime guard の責務分離を明確化
- [ ] top-level await 必須要件を確定
- [ ] screenshot 最小仕様（jpeg/png, 複数枚, 上限）を確定

### Phase 1: 最小 REPL 疎通
- [ ] Host-Kernel JSON Lines 疎通の実装
- [ ] playwrightrepl_exec の最小実装
- [ ] playwrightrepl_reset の最小実装
- [ ] timeout + kill + restart 実装
- [ ] top-level await 最小セルの疎通確認

### Phase 2: tree-sitter ガード実装
- [ ] JavaScript parser 初期化の実装
- [ ] 禁止ルール query 実装
- [ ] 拒否レスポンス（rule_id, node_type, line/column, short_message）実装
- [ ] fail-closed（検査不能時に拒否）実装

### Phase 3: ランタイム能力制限
- [ ] contextCodeGeneration.strings = false 適用
- [ ] contextCodeGeneration.wasm = false 適用
- [ ] microtaskMode = afterEvaluate 適用
- [ ] require/process/module/Buffer の非公開化
- [ ] import 拒否 linker 実装
- [ ] async キュー経由の回避経路対策を実装

### Phase 4: Playwright 固定ハンドル統合
- [ ] BrowserContext / Page の Host 管理実装
- [ ] pw.page / pw.context / pw.helpers 注入実装
- [ ] セル跨ぎ再利用の確認
- [ ] セル失敗後のハンドル維持確認
- [ ] reset 時の再生成確認

### Phase 5: 出力制御とエラー分類
- [ ] 入出力サイズ上限の実装
- [ ] screenshot 出力（jpeg/png）実装
- [ ] screenshot 複数枚返却の実装
- [ ] 画像サイズ上限超過時エラー実装
- [ ] エラー分類（syntax_guard/runtime_guard/playwright_runtime/infrastructure）実装

### Phase 6: テスト
- [ ] 単体: tree-sitter ルール検出
- [ ] 単体: parser 初期化失敗時ハンドリング
- [ ] 単体: timeout リカバリ
- [ ] 単体: microtaskMode=afterEvaluate 回帰
- [ ] 単体: top-level await セル実行
- [ ] 結合: page 永続化
- [ ] 結合: reset 再初期化
- [ ] 結合: screenshot 複数枚返却
- [ ] セキュリティ回帰: import/require/eval 拒否
- [ ] セキュリティ回帰: new Function 拒否
- [ ] セキュリティ回帰: setTimeout("...")/setInterval("...") 拒否
- [ ] セキュリティ回帰: protocol 汚染入力拒否

## 実装ログ
- 2026-03-15: 文書初期化。Phase 0 未着手。

## 次アクション
1. Phase 0 の成果物要点を確定する
2. src/playwright_repl の最小構成を作成する
3. test/unittest/playwright_repl の最小構成を作成する
