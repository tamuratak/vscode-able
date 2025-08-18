import { CancellationToken, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult, LanguageModelTextPart, LogOutputChannel } from 'vscode'
import * as vscode from 'vscode'
import { MatchInfo, parseVarMatchesFromText } from './annotationlib/annotationparser.js'
import { debugObj } from '../utils/debug.js'


interface AnnotationInput {
    filePath: string,
    code: string,
}

interface AnnotationMetaEntry {
    varname: string
    localLine: number
    localCol: number
    type: string
    definitions?: { filePath: string, line: number, character: number }[] | undefined
    hoverText: string | undefined
}

export const annotationToolName = 'able_annotation'

export class AnnotationTool implements LanguageModelTool<AnnotationInput> {

    constructor(
        private readonly extension: {
            readonly outputChannel: LogOutputChannel
        }
    ) {
        this.extension.outputChannel.info('[AnnotationTool]: AnnotationTool created')
    }

    private errorResponse(message: string): LanguageModelToolResult {
        return new LanguageModelToolResult([new LanguageModelTextPart(`${annotationToolName} error: ${message}`)])
    }

    async invoke(options: LanguageModelToolInvocationOptions<AnnotationInput>, token: CancellationToken) {
        const { filePath, code: text } = options.input
        const uri = vscode.Uri.file(filePath)
        this.extension.outputChannel.debug(`[AnnotationTool]: invoke on ${filePath}`)

        let doc: vscode.TextDocument
        try {
            doc = await vscode.workspace.openTextDocument(uri)
        } catch (e) {
            this.extension.outputChannel.error(`[AnnotationTool]: cannot open document: ${String(e)}`)
            return this.errorResponse(`failed to open document at ${filePath}`)
        }

        const docString = doc.getText()

        const matches: MatchInfo[] = parseVarMatchesFromText(text)
        const textLines = text.split(/\r?\n/)

        if (matches.length === 0) {
            this.extension.outputChannel.debug('[AnnotationTool]: no variable occurrences found in provided text')
            return this.errorResponse('no variable occurrences found in provided text')
        }

        const textStartInDoc = docString.indexOf(text)
        if (textStartInDoc >= 0) {
            this.extension.outputChannel.debug('[AnnotationTool]: found provided text in document; using direct offsets for hover positions')
        } else {
            this.extension.outputChannel.debug('[AnnotationTool]: provided text not found in document')
            return this.errorResponse('provided text not found in document')
        }

        const annotationsByLine: Map<number, string[]> = new Map<number, string[]>()
        const metadata: { annotations: AnnotationMetaEntry[] } = { annotations: [] }

        for (const m of matches) {
            if (token.isCancellationRequested) {
                this.extension.outputChannel.debug('[AnnotationTool]: cancelled')
                return this.errorResponse('operation cancelled')
            }

            const startPos = doc.positionAt(textStartInDoc)
            const docLine = startPos.line + m.localLine
            // If the match is on the first line of the fragment, add the start character offset
            // to account for the fragment starting mid-line in the document
            const docCol = m.localLine === 0 ? startPos.character + m.localCol : m.localCol
            const hoverPos = new vscode.Position(docLine, docCol)

            const { typeText, hoverText } = await this.typeTextHoverText(hoverPos, uri, m)

            // attempt to find definition location(s) for the identifier (absolute file path)
            const typeSourceDefinitions: { filePath: string, line: number, character: number }[] = []
            try {
                const defs = await vscode.commands.executeCommand<readonly vscode.Location[]>('vscode.executeDefinitionProvider', uri, hoverPos)
                for (const defLoc of defs) {
                    const defUri = defLoc.uri
                    const defRange = defLoc.range
                    if (defUri && defUri.fsPath && defRange && defRange.start) {
                        typeSourceDefinitions.push({ filePath: defUri.fsPath, line: defRange.start.line, character: defRange.start.character })
                    }
                }
            } catch (e) {
                this.extension.outputChannel.debug(`[AnnotationTool]: definition lookup failed for ${m.varname} - ${String(e)}`)
            }

            const comment = `// ${m.varname} satisfies ${typeText}`
            const existing = annotationsByLine.get(m.localLine) || []
            if (!existing.includes(comment)) {
                existing.push(comment)
                annotationsByLine.set(m.localLine, existing)
            }

            // record metadata for this identifier, include all found definitions if any
            metadata.annotations.push({
                varname: m.varname,
                localLine: m.localLine,
                localCol: m.localCol,
                type: typeText,
                definitions: typeSourceDefinitions.length > 0 ? typeSourceDefinitions : undefined,
                hoverText
            })
        }

        const outLines: string[] = []
        for (let li = 0; li < textLines.length; li++) {
            const original = textLines[li]
            const ann = annotationsByLine.get(li) || []
            if (ann.length === 0) {
                outLines.push(original)
            } else {
                const toAdd = ann.filter(a => !original.includes(a))
                if (toAdd.length === 0) {
                    outLines.push(original)
                } else {
                    outLines.push(original + ' ' + toAdd.join(' '))
                }
            }
        }

        const annotatedText = outLines.join('\n')
        this.extension.outputChannel.debug('[AnnotationTool]: building annotated text complete')

        const jsonMeta = JSON.stringify(metadata, null, 2)
        debugObj('[AnnotationTool]: ', { annotatedText, metadata }, this.extension.outputChannel)
        return new LanguageModelToolResult([
            new LanguageModelTextPart(annotatedText),
            new LanguageModelTextPart(jsonMeta)
        ])
    }

    private async typeTextHoverText(hoverPos: vscode.Position, uri: vscode.Uri, m: MatchInfo) {
        let typeText = '<unknown>'
        let hoverText = ''
        try {
            const raw = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, hoverPos)
            if (raw && raw.length > 0) {
                const hoverItems = raw
                hoverText = hoverItems.map(h => {
                    return h.contents.map(c => stringifyHoverContent(c)).filter(s => s.length > 0).join('\n')
                }).join('\n---\n')
                const reVar = new RegExp(escapeRegex(m.varname) + '\\s*:\\s*([^\\n\\r]*)')
                const mv = hoverText.match(reVar)
                if (mv && mv[1]) {
                    typeText = mv[1].trim()
                } else {
                    const m2 = hoverText.match(/:\\s*([^\\n\\r]+)/)
                    if (m2 && m2[1]) {
                        typeText = m2[1].trim()
                    } else {
                        const firstNonEmpty = hoverText.split(/\r?\n/).map(s => s.trim()).find(s => s.length > 0)
                        typeText = firstNonEmpty || '<unknown>'
                    }
                }
            } else {
                typeText = '<no-hover>'
            }
        } catch (e) {
            this.extension.outputChannel.error(`[AnnotationTool]: hover failed for ${m.varname} - ${String(e)}`)
            typeText = '<hover-error>'
        }
        typeText = typeText.replace(/^['"`]+|['"`]+$/g, '').trim()
        return { typeText, hoverText }
    }

}

function stringifyHoverContent(c: vscode.MarkdownString | vscode.MarkedString): string {
    if (typeof c === 'string') {
        return c
    } else {
        return c.value
    }
}

function escapeRegex(s: string) {
    return s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')
}


// parseVarMatchesFromText and MatchInfo are implemented in
// `src/lmtools/annotationlib/annotationparser.ts`

/**
# AnnotationTool — English reference (Markdown)

## Purpose
Automatically annotate a given TypeScript code fragment by appending comments that show the inferred type for each variable occurrence. The tool returns the annotated code as a string (no file writes).

This file was refactored to extract the variable-detection logic into an exported, pure helper so it can be unit-tested more easily:

- `export interface MatchInfo` — shape of each detected identifier (line/col relative to the provided text)
- `export function parseVarMatchesFromText(text: string): MatchInfo[]` — returns identifiers found in the text fragment

The `AnnotationTool` class now calls `parseVarMatchesFromText` to obtain variable occurrences and then uses the hover provider to infer types and build annotated output.

## Input (shape)
- Type: object
- Properties:
    - `filePath`: string — absolute path to the target file
    - `code`: string — the TypeScript code fragment to analyze (the selection)
- Required: `filePath`, `code`

(Encapsulated in the extension as `AnnotationInput`)

## Output (shape)
-- A `LanguageModelToolResult` containing two `LanguageModelTextPart`s:
     1. The annotated code string (comments appended inline)
     2. A JSON string containing structured metadata about the annotations

- Annotation format appended to lines:
        - `// <varname> satisfies <Type>`

### Metadata schema
- The second `LanguageModelTextPart` is a pretty-printed JSON object with the shape:

```json
{
    "annotations": [
        {
            "varname": "<identifier>",
            "localLine": 0,
            "localCol": 0,
            "type": "<inferred type string>",
            "definitions": [
                { "filePath": "/abs/path/to/def.ts", "line": 10, "character": 4 }
            ] | undefined,
            "hoverText": "<raw hover text>" | undefined
        }
    ]
}
```

- `definitions`: optional array containing zero or more definition locations discovered via the VS Code definition provider. Each entry contains an absolute `filePath`, `line`, and `character` for the definition start. If no definitions were found, the field is `undefined`.
- `hoverText`: optional string containing the concatenated hover contents (if any) that were used to infer the `type` value

## High-level behavior
1. Open the document at `filePath`.
2. Use `parseVarMatchesFromText(code)` to detect identifiers in the provided code fragment. That function returns identifiers with line/column offsets relative to `code`.
3. For each detected identifier, map to a document position:
     - If the provided `code` exactly occurs in the document, map lines/columns relative to that occurrence
     - Otherwise, fallback to searching the document for the identifier occurrence (first match)
4. Use the hover provider to obtain type info:
     - Call `vscode.executeHoverProvider(uri, position)` to get hover items
     - Convert hover contents to plain text
     - Prefer patterns like `<name>: <Type>`; otherwise pick the first meaningful hover line
5. Append comment(s) to the corresponding line in the provided `code`:
     - Avoid duplicating identical comments
6. Return the new annotated code as the tool result (no file edits)

## Detection patterns (implemented in `parseVarMatchesFromText`)
- simple declarations:
    - `const|let|var <identifier> = ...` — `/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g`
- for-of loops:
    - `for (const|let|var <identifier> of ...)` — `/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\b/g`
- async iteration:
    - `for await (const|let|var <identifier> of ...)` — `/\bfor\s*await\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\b/g`
- destructuring (object):
    - `const { a, b: alias } = ...` — `/\b(?:const|let|var)\s*\{([^}]+)\}\s*=/g` (then split and extract identifiers)
- destructuring (array):
    - `const [x, , y] = ...` — `/\b(?:const|let|var)\s*\[([^\]]+)\]\s*=/g` (then split and extract identifiers)
- `catch` parameter:
    - `catch (err)` — `/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g`

Notes:
- `parseVarMatchesFromText` performs heuristic parsing for destructuring by comma-splitting and simple name extraction. It does not fully parse nested or very complex patterns — consider using the TypeScript AST for robust extraction.

## Position mapping rules
- Preferred: find exact `code` substring in document; compute `startLine` and offset lines/columns relative to that start position
- Fallback: regex-search the whole document for the identifier and use the first match to compute hover position
- The hover position is placed on the identifier token (character position)

## Hover extraction algorithm
- Call `vscode.executeHoverProvider(uri, position)` → returns `Hover[]`
- Convert each `Hover.contents` to plain text (join markdown/string parts)
- Attempt extraction in this order:
    1. Match `<identifier>\s*:\s*([^\n\r]*)` (prefer `name: Type`)
    2. Match first `:\s*([^\n\r]+)` (any colon-separated type)
    3. Otherwise take the first non-empty hover line
- Normalize the extracted text (strip surrounding quotes/backticks)
- If hover missing or extraction fails, use fallback tokens:
    - `<no-hover>`, `<no-position>`, `<hover-error>`, `<unknown>`

## Cancellation and logging
- The method accepts a `CancellationToken`:
    - If cancellation is requested during processing, the tool returns early
- Logs progress/errors to the extension output channel (used for debugging and user feedback)

## Return contract
- Always return a `LanguageModelToolResult` wrapping a `LanguageModelTextPart` with the annotated string (even on early exit/error, it returns the original or partially annotated text inside a `LanguageModelToolResult`).
- The caller (LLM controller) receives the string and may choose to apply it to the file or present it to the user.
 - Always return a `LanguageModelToolResult` wrapping two `LanguageModelTextPart`s: the annotated code and a JSON metadata string. On early exit/error, the tool still returns a `LanguageModelToolResult`; the metadata part may be an empty/partial object.
 - The caller (LLM controller) receives both the annotated text and the structured metadata and can consume the JSON programmatically (for example, to feed to an LLM or to present a richer UI).

## Example (input → output)
Input `code`:
```ts
const items = getItems()
for (const it of items) {
    const { id, value: v } = it
    let count = 0
}
```

Possible annotated output (returned string):
```ts
const items = getItems() // items satisfies Item[]
for (const it of items) { // it satisfies Item
    const { id, value: v } = it // id satisfies string // v satisfies number
    let count = 0 // count satisfies number
}
```

## Testing notes
- `parseVarMatchesFromText` is exported and pure — unit tests should call it directly with small code fragments and assert the returned `MatchInfo[]` values (lines/cols/identifiers).
- Integration tests can call `AnnotationTool.invoke` with a temporary file (or a mocked `vscode.workspace.openTextDocument` / hover provider) to assert annotated output.

## Suggested improvements
- Use the TypeScript AST (Compiler API) to extract identifiers precisely (handles nested destructuring, parameters, class fields, etc.) — recommended for robustness
- Cache hover results by identifier/position to reduce repeated calls
- Provide an option to apply edits to the file, update existing annotations, or show a preview/diff
- Improve position mapping to prefer matches closest to the selection or to accept more precise offsets if multiple occurrences exist

## Implementation notes (where to find / key symbols)
- File: `src/lmtools/annotation.ts`
- Input interface: `AnnotationInput` with `filePath` and `code`
- Main method: `async invoke(options: LanguageModelToolInvocationOptions<AnnotationInput>, token: CancellationToken)`
- Returns: `new LanguageModelToolResult([new LanguageModelTextPart(annotatedText), new LanguageModelTextPart(jsonMeta)])`
- Uses `vscode.commands.executeCommand('vscode.executeHoverProvider', uri, position)` to obtain type info

*/
