# Playwright REPL ブラッシュアップ実行計画 v2（Living Doc）

## 0. 運用ルール
- マスター計画: [plan-2.md](plan-2.md)
- 実行ログ: この文書を更新する
- 方針変更時は理由を実装ログに残す

## 1. 現在ステータス
- 全体進捗: 20%
- 現在フェーズ: Phase A（分析と計画固定）
- 現在タスク: API 充足性評価と返却フォーマット方針の固定
- ブロッカー: なし
- 最終更新日: 2026-03-15

## 2. フェーズ別チェックリスト

### Phase A: 分析と方針固定
- [x] 現行 API 一覧を [src/playwright_repl/session.ts](src/playwright_repl/session.ts) から抽出
- [x] Playwright docs との差分を確認
- [x] `value: undefined` の原因を [src/playwright_repl/kernel.ts](src/playwright_repl/kernel.ts) で確認
- [x] ユーザー方針を質問で確定
  - value は固定運用
  - LLM 利用値は疑似 XML タグで返却

### Phase B: 返却フォーマット改善計画
- [ ] 成功時タグセットを確定
- [ ] 失敗時タグセットを確定
- [ ] タグの必須/任意ルールを確定
- [ ] エスケープ方針（改行、`<`, `>`, `&`）を確定
- [ ] 1 実行あたりの最大出力サイズ方針を確定
- [ ] 既存 summary 行との互換方針を確定
- [ ] 単体テスト期待値の変更一覧を作成
- [ ] VS Code 統合テスト期待値の変更一覧を作成
- [ ] Phase B 完了条件を満たしたことを記録
  - 成功/失敗の双方でタグ仕様が文書化されている
  - テスト変更対象がファイル単位で列挙されている

### Phase C: session API 拡張計画
- [ ] locator API 方針を確定
  - page.locator を直接公開するか、限定ラッパーを公開するかを決定
  - getByRole/getByText の公開可否を決定
  - selector と role 指定の優先ルールを決定
- [ ] locator API の実装詳細を定義
  - locator 作成の識別子設計（例: locator id）
  - locator インスタンス保持期間（1 exec 内 / セッション跨ぎ）
  - locator に対する操作セット（click/fill/textcontent/waitfor）
  - locator 破棄タイミングと reset 時の扱い
- [ ] locator API の安全制約を定義
  - 過剰な locator 生成数の上限
  - 文字列入力長の上限
  - タイムアウト上限
- [ ] locator API のエラー方針を定義
  - selector 不一致
  - strict mode 違反
  - detached element
  - timeout
- [ ] page.waitforselector の仕様を確定
- [ ] page.waitforresponse の仕様を確定
- [ ] page.evaluate の仕様を確定
- [ ] context.route の仕様を確定
- [ ] Playwright ネットワーク制限仕様を確定
  - 許可先ホスト: `127.0.0.1` / `localhost` / `::1`
  - 許可スキーム: `http` / `https`
  - 非許可先アクセス時は例外を投げる
- [ ] REPL Node.js ネットワーク制限仕様を確定
  - `globalThis.fetch` を制限
  - 可能な範囲で `node:http` / `node:https` を制限
  - 非許可先アクセス時は例外を投げる
- [ ] 各 API の入力型と戻り値型を定義
- [ ] 各 API の timeout と retry 方針を定義
- [ ] エラー分類マッピングを API ごとに定義
- [ ] セキュリティ観点レビューを実施
  - DoS リスク
  - 情報漏えいリスク
  - プロトコル汚染リスク
  - ネットワークエグレス制御の迂回リスク
- [ ] Phase C 完了条件を満たしたことを記録
  - API ごとの制約が文書化されている
  - セキュリティレビュー結果がログ化されている

### Phase D: テスト戦略更新
- [ ] VS Code 統合テストの期待値をタグベースへ更新
- [ ] タグ生成の単体テストを追加
  - 正常系（result/logs/screenshots）
  - 異常系（error class/message）
  - エスケープ境界値
- [ ] API 追加分の単体テスト項目を追加
- [ ] API 追加分の統合テスト項目を追加
- [ ] 既存テストから削除/置換する assertion を明示
- [ ] Phase D 完了条件を満たしたことを記録
  - 変更後期待値で安定実行できる
  - 回帰対象が明示されている

## 3. 実装ログ
- 2026-03-15: [plan.md](plan.md) と [planexec.md](planexec.md) の進捗を確認。Phase 6 までほぼ完了状態であることを確認。
- 2026-03-15: [src/playwright_repl/session.ts](src/playwright_repl/session.ts) を調査し、現行公開 API は最小ユースケースには十分だが、安定運用向け API が不足していると判断。
- 2026-03-15: [contexttmp/playwright/docs/src/api/class-page.md](contexttmp/playwright/docs/src/api/class-page.md) と [contexttmp/playwright/docs/src/api/class-browsercontext.md](contexttmp/playwright/docs/src/api/class-browsercontext.md) を参照し、差分候補を抽出。
- 2026-03-15: [src/playwright_repl/kernel.ts](src/playwright_repl/kernel.ts) と [src/playwright_repl/tool.ts](src/playwright_repl/tool.ts) を調査し、`value: undefined` は async IIFE の戻り値仕様由来であることを確認。
- 2026-03-15: ユーザー確認により、value は固定サマリー運用、LLM 利用値は疑似 XML タグで返す方針を採用。
- 2026-03-15: [plan-2.md](plan-2.md) と [planexec-2.md](planexec-2.md) を初版作成。
- 2026-03-15: ユーザー確認により、ネットワーク制限方針を確定（許可先: `127.0.0.1` / `localhost` / `::1`、スキーム: `http/https`、非許可先は例外）。
- 2026-03-15: ユーザー確認により、REPL 側は `globalThis.fetch` に加えて可能な範囲で `node:http` / `node:https` も制限する方針を採用。

## 4. 次アクション
1. Phase B の「成功時タグセット」「失敗時タグセット」を先に確定する
2. Phase C でネットワーク制限（Playwright / REPL fetch / node:http / node:https）の仕様を先に固定する
3. Phase C の API で引数・戻り値・エラー分類を表形式で固める
4. Phase D で既存 assertion の置換対象をファイル単位で列挙する
