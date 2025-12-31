---
title: mermaid parser & analyzer 備忘録
---

## User
- 機能: Markdown 文中の説明文と mermaid classDiagram から、説明文に**言及されている**クラス・メンバー・関係だけを含む新たな mermaid 図を生成。tsparser でクラス情報を解析し、mermaid パーサーで図を読む。
- mermaid 図は ```mermaid ... ``` のコードブロック。説明文の文字列一致で記述済みと判定。
- tsparser を拡張し必要情報を抽出し、tsanalyzer へ集約。mermaid parser と analyzer のテストも用意。

## Assistant
- `src/components/mermaidparser.ts`: classDiagram をパースし、クラス名・属性・メソッド・関係を抽出する型付きモジュールを新規実装。`parseMermaidClassDiagram` テストも `test/unittest/components/mermaidparser.test.ts` に追加。
- `src/components/tsanalyzer.ts`: Markdown を行単位で分割し、説明文トークンの抽出、mermaid/TypeScript データのマージ、説明文で言及されたクラスに絞った mermaid 図（継承・has・calls リレーション含む）の生成ロジックを実装。tsparser からクラス定義を読み出す機能も追加。続いて `test/unittest/components/tsanalyzer.test.ts` で振る舞いを確認。
- mermaid parser では `class Foo` ブロック内の `+bar: Bar` や `+callBar()`、外部の `Foo <|-- Bar` `Foo ..> Bar : calls` を構造化して返す。
- ts analyzer テスト図例:
```
classDiagram
class Foo {
	+bar: Bar
	+callBar()
}
class Bar {
	+doSomething()
}
Foo o-- Bar
```
説明文: Foo, bar, callBar, Bar.doSomething などを言及。
- 出力予想 (説明文で言及された要素のみ):
```
classDiagram
	class Bar {
		doSomething()
	}
	class Foo {
		bar: Bar
		callBar()
	}
	Foo ..> Bar : callBar -> doSomething
	Foo o-- Bar : bar
```
 (また、言及なしなら出力 undefined とテスト)。

### Mermaid diagrams appearing in this session
- Source test diagram:
```
classDiagram
class Foo {
	+bar: Bar
	+callBar()
}
class Bar {
	+doSomething()
}
Foo <|-- Bar
Foo ..> Bar : calls
```
- Analyzer example diagram and generated filter output (see above).

## 参考ファイル
- [src/components/mermaidparser.ts](src/components/mermaidparser.ts): Mermaid パーサー本体、構造体/関係抽出。
- [test/unittest/components/mermaidparser.test.ts](test/unittest/components/mermaidparser.test.ts): パーサーの単体テスト。
- [src/components/tsanalyzer.ts](src/components/tsanalyzer.ts): Markdown→mermaid 図変換ロジック。
- [test/unittest/components/tsanalyzer.test.ts](test/unittest/components/tsanalyzer.test.ts): analyzer の動作確認テスト。
