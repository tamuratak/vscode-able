実コードを読んだうえでの結論です。  
js_repl は「Node 子プロセス + VM モジュール文脈 + Codex ツールブリッジ」の3層構成で、sandbox は「OS サンドボックス」と「JS レベル制約」の二重で実現されています。

**1. runtime は何か**
- 実体は Node ランタイムです。Rust 側で Node を解決して起動し、kernel.js を渡して常駐 REPL カーネルとして使っています。
- Node の最小要件は [codex-rs/node-version.txt](codex-rs/node-version.txt#L1) の 22.22.0。
- 起動時に互換 Node を検証し、要件未満なら機能をセッションで無効化します。実装は [codex-rs/core/src/codex.rs](codex-rs/core/src/codex.rs#L445) と [codex-rs/core/src/codex.rs](codex-rs/core/src/codex.rs#L456)。
- 解決順は環境変数 → 設定 → PATH です。実装は [codex-rs/core/src/tools/js_repl/mod.rs](codex-rs/core/src/tools/js_repl/mod.rs#L1915) と [codex-rs/core/src/tools/js_repl/mod.rs](codex-rs/core/src/tools/js_repl/mod.rs#L1922) と [codex-rs/core/src/tools/js_repl/mod.rs](codex-rs/core/src/tools/js_repl/mod.rs#L1928)。
- 実行は Node に --experimental-vm-modules を付けて kernel.js を起動します。[codex-rs/core/src/tools/js_repl/mod.rs](codex-rs/core/src/tools/js_repl/mod.rs#L1030)

**2. sandbox はどう実現しているか**
- OS レイヤー:
  - js_repl 起動コマンドは共通 SandboxManager を通して変換されます。[codex-rs/core/src/tools/js_repl/mod.rs](codex-rs/core/src/tools/js_repl/mod.rs#L1041) と [codex-rs/core/src/tools/js_repl/mod.rs](codex-rs/core/src/tools/js_repl/mod.rs#L1056)
  - macOS では seatbelt ラッパー、Linux では linux sandbox ラッパー、Windows は restricted token 経路です。[codex-rs/core/src/sandboxing/mod.rs](codex-rs/core/src/sandboxing/mod.rs#L647) 以降
  - ネットワーク制限時は環境変数で制約状態を伝播します。[codex-rs/core/src/sandboxing/mod.rs](codex-rs/core/src/sandboxing/mod.rs#L636)
- JS レイヤー:
  - kernel.js は vm.createContext で独立コンテキストを作り、そこで各セルを SourceTextModule として実行します。[codex-rs/core/src/tools/js_repl/kernel.js](codex-rs/core/src/tools/js_repl/kernel.js#L25) と [codex-rs/core/src/tools/js_repl/kernel.js](codex-rs/core/src/tools/js_repl/kernel.js#L1587)
  - process グローバルを出さない設計で、テストでも undefined を確認しています。[codex-rs/core/tests/suite/js_repl.rs](codex-rs/core/tests/suite/js_repl.rs#L639)
  - 危険 builtin の import を拒否します（process / child_process / worker_threads）。[codex-rs/core/src/tools/js_repl/kernel.js](codex-rs/core/src/tools/js_repl/kernel.js#L102) と [codex-rs/core/src/tools/js_repl/kernel.js](codex-rs/core/src/tools/js_repl/kernel.js#L375)、検証テストは [codex-rs/core/tests/suite/js_repl.rs](codex-rs/core/tests/suite/js_repl.rs#L691)

**3. Playwright 連携の仕組みはあるか**
- js_repl 本体に Playwright 専用の分岐や専用 API はありません（専用ハンドラなし）。
- ただし連携経路は2つあります。
  1. Node パッケージとして playwright を import して使う経路（モジュール解決は kernel.js が担当）。[codex-rs/core/src/tools/js_repl/kernel.js](codex-rs/core/src/tools/js_repl/kernel.js#L289) と [codex-rs/core/src/tools/js_repl/kernel.js](codex-rs/core/src/tools/js_repl/kernel.js#L399)
  2. codex.tool と codex.emitImage を使って外部ツール結果やスクショを会話出力に載せる経路。[codex-rs/core/src/tools/js_repl/kernel.js](codex-rs/core/src/tools/js_repl/kernel.js#L1440) と [codex-rs/core/src/tools/js_repl/kernel.js](codex-rs/core/src/tools/js_repl/kernel.js#L1480)
- Playwright スクリーンショット例はドキュメント生成コードに明示されています。[codex-rs/core/src/project_doc.rs](codex-rs/core/src/project_doc.rs#L60)

**補足: js_repl_tools_only**
- 直接ツール呼び出しを封じて js_repl / js_repl_reset のみ直接許可し、他は js_repl 内の codex.tool 経由にする制御があります。[codex-rs/core/src/tools/router.rs](codex-rs/core/src/tools/router.rs#L251)

必要なら次に、実際の呼び出しシーケンス（モデル→js_repl→kernel→run_tool→router→結果返却）を時系列図で1ページにまとめます。