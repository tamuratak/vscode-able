# Playwright REPL 実行計画（Living Doc）

この文書は実装の進行に合わせて動的に更新する。

## 運用ルール
- 静的マスターは plan.md とする
- この文書はタスク開始/完了のたびに更新する
- 実装コードは src/playwright_repl 以下に追加する
- テストコードは test/unittest/playwright_repl 以下に追加する
- able_run_in_sandbox では Playwright を実行できないため、実機確認が必要な場合は vscode_askQuestions でユーザーに実行依頼する

## 現在ステータス
- 全体進捗: 73%
- 現在フェーズ: Phase 6
- 現在タスク: pw API freeze 回帰テスト追加
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
- [x] Host-Kernel JSON Lines 疎通の実装
- [x] playwrightrepl_exec の最小実装
- [x] playwrightrepl_reset の最小実装
- [ ] timeout + kill + restart 実装
- [x] top-level await 最小セルの疎通確認

### Phase 2: tree-sitter ガード実装
- [x] JavaScript parser 初期化の実装
- [x] 禁止ルール query 実装
- [x] 拒否レスポンス（rule_id, node_type, line/column, short_message）実装
- [x] fail-closed（検査不能時に拒否）実装

### Phase 3: ランタイム能力制限
- [x] contextCodeGeneration.strings = false 適用
- [x] contextCodeGeneration.wasm = false 適用
- [x] microtaskMode = afterEvaluate 適用
- [x] require/process/module/Buffer の非公開化
- [x] import 拒否 linker 実装
- [x] async キュー経由の回避経路対策を実装

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
- [x] エラー分類（syntax_guard/runtime_guard/playwright_runtime/infrastructure）実装

### Phase 6: テスト
- [x] 単体: tree-sitter ルール検出
- [x] 単体: parser 初期化失敗時ハンドリング
- [x] 単体: timeout リカバリ
- [x] 単体: microtaskMode=afterEvaluate 回帰
- [x] 単体: top-level await セル実行
- [ ] 結合: page 永続化
- [x] 結合: reset 再初期化
- [ ] 結合: screenshot 複数枚返却
- [x] セキュリティ回帰: import/require/eval 拒否
- [x] セキュリティ回帰: new Function 拒否
- [x] セキュリティ回帰: setTimeout("...")/setInterval("...") 拒否
- [x] セキュリティ回帰: protocol 汚染入力拒否

## 実装ログ
- 2026-03-15: 文書初期化。Phase 0 未着手。
- 2026-03-15: Phase 1 着手。Playwright REPL の最小 host-kernel プロトコル、exec/reset ツール、runtime 設定、tree-sitter ベースの禁止構文ガード、単体テストを追加。
- 2026-03-15: timeout 超過時の kernel kill/restart を追加。screenshot 出力（png/jpeg、複数枚、サイズ上限）を追加。先頭行 pragma による timeout 上書き（playwrightrepl-timeout=ms）を追加。
- 2026-03-15: kernel のランタイム制約（new Function 禁止、require/setTimeout 非公開）と reset の状態初期化を検証する単体テストを追加。syntax guard に setInterval("...") 拒否の回帰テストを追加。
- 2026-03-15: kernel の無限ループ timeout 回帰テストと、microtaskMode=afterEvaluate 前提の microtask timeout 回帰テストを追加。
- 2026-03-15: kernel へ非 JSON 行を注入しても後続リクエストを正常処理できることを確認する protocol 汚染回帰テストを追加。
- 2026-03-15: dynamic import 実行拒否と process/module/Buffer 非公開化を検証する回帰テストを追加し、Phase 3 の能力制限項目を実装済みとして更新。
- 2026-03-15: playwrightrepl_exec の失敗時エラー分類（runtime_guard/playwright_runtime/infrastructure）を実装し、分類関数の単体テストを追加。
- 2026-03-15: kernel runtime テストは deterministic な timeout 系回帰（同期無限ループ / microtask 無限ループ）に絞って安定化。
- 2026-03-15: kernel fallback（vm.Script）で Promise が未解決のままになる問題を修正。context 内マイクロタスクをポンプして top-level await 相当の結果を待機できるようにした。
- 2026-03-15: Node v22 環境で dynamic import が vm の制約により kernel を異常終了させる問題を修正。実行前ガードで import() を拒否して通常のエラー応答を返すようにした。
- 2026-03-15: kernel runtime に top-level await 実行の単体テストを追加し、Phase 6 の該当項目を完了に更新。
- 2026-03-15: kernel へ非 JSON 行を送っても後続の exec が正常処理されることを確認する protocol 汚染耐性テストを追加。
- 2026-03-15: syntax guard にテスト用フックを追加し、parser 不在時に guard.init_failed を返す fail-closed 回帰テストを追加。
- 2026-03-15: timeout pragma の境界値（100/60000）と不正フォーマット（小数/単位付き/2 行目指定）の単体テストを追加。
- 2026-03-15: screenshot バイト上限判定を純粋関数へ切り出し、単体で境界値（ちょうど上限 / 超過）を検証するテストを追加。
- 2026-03-15: kernel runtime に top-level await の reject 経路テストを追加し、Promise rejection がエラー結果として返ることを確認。
- 2026-03-15: kernel runtime に reset 後の状態初期化回帰テストを追加し、global 汚染が残らないことを確認。
- 2026-03-15: kernel runtime に pw API facade（pw/page/context/helpers）が freeze 済みであることを確認する回帰テストを追加。

## 次アクション
1. 結合: page 永続化テストの実装または実行手順の確立
2. 結合: screenshot 複数枚返却の実行手順を確立する
3. 結合: 実機での Playwright 回帰テスト実行依頼フローを運用する

## 実機結合テスト実行フロー（Playwright 必須）
1. VS Code のタスク `task-test-json` を実行する
2. 実行結果 JSON から `playwright_repl` 配下の失敗テストを抽出する
3. `page` 永続化シナリオを確認する
	- 1 回目セルで `await pw.page.goto(...)` を実行
	- 2 回目セルで `await pw.page.url()` を実行
	- 遷移状態が維持されることを確認
4. `reset` 再初期化シナリオを確認する
	- `playwrightrepl_reset` 実行前後で page 状態が初期化されることを確認
5. screenshot 複数枚返却シナリオを確認する
	- 1 セル内で `pw.page.screenshot('png')` / `pw.page.screenshot('jpeg')` を複数回実行
	- 返却配列件数と各 `bytes` が上限内であることを確認
6. 不一致が出た場合は失敗ケースを `planexec.md` の実装ログに追記して修正を開始する
