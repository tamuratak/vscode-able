# Playwright REPL 実行計画（living doc）

## 1. 位置づけ

- 本ドキュメントは実装中に更新し続ける living doc
- 要件と設計の静的マスターは plan.md
- 実装中の進捗、判断、逸脱、リスクは本書に記録する

## 2. 固定方針（plan.md から継承）

- ツール名: able_playwright_repl / able_playwright_repl_reset
- top level await を採用する
- screenshot は初期フェーズから実装する
- ネットワークはデフォルト拒否
- 主防御は別プロセス、vm2 は第二防御層

## 3. 実装配置

- 実装ディレクトリ: src/playwright_repl
- テストディレクトリ: test/unittest/playwright_repl

想定ファイル:

- src/playwright_repl/playwrightrepltool.ts
- src/playwright_repl/playwrightrunner.ts
- test/unittest/playwright_repl/playwrightrepltool.test.ts
- test/unittest/playwright_repl/playwrightrunner.test.ts

## 4. フェーズ進行管理

### フェーズ 7: validator 正規表現除去（追加）

- 状態: DONE
- 完了条件:
  - codevalidator.ts の禁止判定が regex 非依存
  - tree-sitter AST 判定のみで import/import()/require()/process を拒否
  - 文字列中の語句は誤検知しない

### フェーズ 8: テスト拡張（追加）

- 状態: DONE
- 完了条件:
  - codevalidator の拒否/許可ケースを拡張
  - playwrightrunner の URL 判定・host 正規化・message parse 周辺テストを追加

### フェーズ 1: 骨格

- 状態: DONE
- 完了条件:
  - tool クラスと runner エントリが作成済み
  - main.ts / package.json の登録方針が確定

### フェーズ 2: 実行基盤

- 状態: DONE
- 完了条件:
  - child_process 起動とセッション再利用
  - NDJSON 通信
  - timeout/cancel 時の kill
  - reset 実装
  - top level await 実行

### フェーズ 3: Playwright ラッパー

- 状態: DONE
- 完了条件:
  - browser/context/page ライフサイクル管理
  - pw 最小 API 実装
  - browserType/headless 反映
  - network deny by default

### フェーズ 4: screenshot

- 状態: DONE
- 完了条件:
  - pw.screenshot(jpeg/png)
  - CSS 正規化
  - 画像 + メタ返却
  - バイト上限/レート制限

### フェーズ 5: 制約強化

- 状態: DONE
- 完了条件:
  - tree-sitter validation
  - 禁止 API fail-fast
  - エラーメッセージ整形

### フェーズ 6: テスト

- 状態: DONE (ユニットテスト追加、実行はユーザー依頼待ち)
- 完了条件:
  - セッション継続/reset/timeout
  - 禁止 API/ネットワーク拒否
  - top level await
  - screenshot 返却と正規化

## 5. 進捗ログ

- 2026-03-16: plan.md を静的マスター化し、配置先を src/playwright_repl と test/unittest/playwright_repl に確定
- 2026-03-16: planexec.md を初期化
- 2026-03-17: src/playwright_repl に codevalidator.ts / playwrightrunner.ts / playwrightrepltool.ts を追加
- 2026-03-17: src/main.ts と package.json に tool 登録と able.playwrightRepl.* 設定を追加
- 2026-03-17: test/unittest/playwright_repl に codevalidator.test.ts / playwrightrunner.test.ts を追加
- 2026-03-17: follow-up として validator の regex 廃止とテストカバレッジ強化タスクを開始
- 2026-03-17: codevalidator を tree-sitter AST 判定のみへ移行（regex 廃止）
- 2026-03-17: runnermessage.ts を追加し、message parse を分離してテストを拡張

## 6. 現在の次アクション

1. src/playwright_repl の骨格ファイルを作成
2. main.ts と package.json の登録差分を実装
3. フェーズ 1 完了後に本書の状態を TODO -> DONE に更新
4. vscodeunittest の実行結果をユーザーから受領し、必要なら修正
