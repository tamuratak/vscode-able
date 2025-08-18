import { CancellationToken, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult, LanguageModelTextPart, LogOutputChannel } from 'vscode'
import * as vscode from 'vscode'
import { MatchInfo, parseVarMatchesFromText } from './annotationlib/annotationparser.js'


interface AnnotationInput {
    filePath: string,
    code: string,
}

interface Def {
    filePath: string,
    line: number
    startLine?: number
    endLine?: number
    definitionText?: string
    method?: string
}

interface AnnotationMetaEntry {
    varname: string
    localLine: number
    localCol: number
    type: string
    definitions?: Def[] | undefined
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
            const typeSourceDefinitions: Def[] = []
            try {
                const defs = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeTypeDefinitionProvider', uri, hoverPos)
                for (const defLoc of defs) {
                    let defUri: vscode.Uri | undefined
                    let defRange: vscode.Range | undefined
                    if (defLoc instanceof vscode.Location) {
                        defUri = defLoc.uri
                        defRange = defLoc.range
                    } else if (this.isLocationLink(defLoc)) {
                        if (defLoc.targetUri) {
                            defUri = defLoc.targetUri
                        }
                        if (defLoc.targetRange) {
                            defRange = defLoc.targetRange
                        } else if (defLoc.targetSelectionRange) {
                            defRange = defLoc.targetSelectionRange
                        }
                    }
                    if (defUri && defUri.fsPath && defRange && defRange.start) {
                        // try to extract full definition text using DocumentSymbolProvider
                        try {
                            const defInfo = await this.getDefinitionTextFromUriAtPosition(defUri, defRange.start)
                            typeSourceDefinitions.push({
                                filePath: defUri.fsPath,
                                line: defRange.start.line,
                                startLine: defInfo.startLine,
                                endLine: defInfo.endLine,
                                definitionText: defInfo.text,
                                method: defInfo.method
                            })
                        } catch (e) {
                            this.extension.outputChannel.debug(`[AnnotationTool]: definition text extraction failed for ${m.varname} - ${String(e)}`)
                            typeSourceDefinitions.push({
                                filePath: defUri.fsPath,
                                line: defRange.start.line
                            })
                        }
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
        this.extension.outputChannel.debug('[AnnotationTool]:')
        this.extension.outputChannel.debug(annotatedText)
        this.extension.outputChannel.debug(jsonMeta)
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

    private async getDefinitionTextFromUriAtPosition(defUri: vscode.Uri, pos: vscode.Position) {
        // attempt to get document symbols for the target document
        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', defUri)
            if (symbols && symbols.length > 0) {
                // find smallest enclosing symbol
                let best: vscode.DocumentSymbol | undefined
                let bestRangeSize = Number.MAX_SAFE_INTEGER
                const visit = (sym: vscode.DocumentSymbol) => {
                    const r = sym.range
                    if (this.positionInRange(pos, r)) {
                        const size = (r.end.line - r.start.line) * 1000 + (r.end.character - r.start.character)
                        if (size < bestRangeSize) {
                            best = sym
                            bestRangeSize = size
                        }
                    }
                    if (sym.children) {
                        for (const c of sym.children) {
                            visit(c)
                        }
                    }
                }
                for (const s of symbols) {
                    visit(s)
                }
                if (best) {
                    // open document and extract text for best.range
                    const doc = await vscode.workspace.openTextDocument(defUri)
                    const startLine = best.range.start.line
                    const endLine = best.range.end.line
                    let text = doc.getText(new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine + 1, 0)))
                    // trim if too large
                    const maxLines = 40
                    const lines = text.split(/\r?\n/)
                    let truncated = false
                    if (lines.length > maxLines) {
                        text = lines.slice(0, maxLines).join('\n') + '\n// ...(truncated)'
                        truncated = true
                    }
                    return { startLine, endLine, text, method: 'documentSymbol', truncated }
                }
            }
        } catch (e) {
            this.extension.outputChannel.debug(`[AnnotationTool]: executeDocumentSymbolProvider failed - ${String(e)}`)
        }

        // fallback: open document and return a small snippet around pos
        try {
            const doc = await vscode.workspace.openTextDocument(defUri)
            const startLine = Math.max(0, pos.line - 2)
            const endLine = Math.min(doc.lineCount - 1, pos.line + 20)
            const text = doc.getText(new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine + 1, 0)))
            return { startLine, endLine, text, method: 'fallback-range' }
        } catch (e) {
            this.extension.outputChannel.debug(`[AnnotationTool]: openTextDocument failed for ${defUri.fsPath} - ${String(e)}`)
            throw e
        }
    }

    private positionInRange(pos: vscode.Position, range: vscode.Range) {
        if (pos.line < range.start.line || pos.line > range.end.line) {
            return false
        }
        if (pos.line === range.start.line && pos.character < range.start.character) {
            return false
        }
        if (pos.line === range.end.line && pos.character > range.end.character) {
            return false
        }
        return true
    }

    private isLocationLink(x: object | undefined): x is vscode.LocationLink {
        if (!x || typeof x !== 'object') {
            return false
        }
        return ('targetUri' in x) || ('targetRange' in x) || ('targetSelectionRange' in x)
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


/**
# AnnotationTool — English reference (Markdown)

## Purpose
Automatically annotate a given TypeScript/JavaScript code fragment by appending end-of-line comments that show the inferred type for each variable occurrence. The tool does not write to disk; it returns the annotated text (and structured metadata) as the tool result.

This file delegates identifier detection to a helper so the detection logic can be unit-tested independently:

- `MatchInfo` — shape of each detected identifier (line/col relative to the provided text)
- `parseVarMatchesFromText(text: string): MatchInfo[]` — returns identifiers found in the text fragment (implemented in `annotationparser.js`)

`AnnotationTool` calls `parseVarMatchesFromText` to find variable occurrences, maps those occurrences into document positions, queries VS Code hover/type providers to infer types, and builds the annotated output and metadata.

## Input (shape)
- Type: object
- Properties:
    - `filePath`: string — absolute path to the target file
    - `code`: string — the code fragment to analyze (the selection)
- Required: `filePath`, `code` (represented by the `AnnotationInput` interface)

## Output
- Success: a `LanguageModelToolResult` containing two `LanguageModelTextPart`s in order:
    1. The annotated source text (original lines with appended `// <varname> satisfies <Type>` comments)
    2. A pretty-printed JSON string containing structured metadata about the annotations
- Error / early exit: a single-part `LanguageModelToolResult` is returned containing an error message string (for example when the document cannot be opened, the provided `code` fragment is not found in the document, or the operation is cancelled).

### Annotation comment format
- Inline comments appended to lines look like:
            // <varname> satisfies <Type>

### Metadata schema (JSON)
- The second `LanguageModelTextPart` (on success) is a JSON object with this shape:

```json
{
    "annotations": [
        {
            "varname": "<identifier>",
            "localLine": 0,
            "localCol": 0,
            "type": "<inferred type string>",
            "definitions": [
                {
                    "filePath": "/abs/path/to/def.ts",
                    "line": 10
                }
            ] | undefined,
            "hoverText": "<raw hover text>" | undefined
        }
    ]
}
```

- `definitions`: optional array containing zero or more definition location objects discovered via `vscode.executeTypeDefinitionProvider`. Each entry currently contains an absolute `filePath` and a `line` number (the start line of the definition). If no definitions were found, the field is `undefined`.
- `hoverText`: optional string containing the concatenated hover contents. It may be an empty string or omitted (`undefined`) depending on provider results.

## High-level behavior
1. Open the document at `filePath` via `vscode.workspace.openTextDocument`.
2. Call `parseVarMatchesFromText(code)` to detect identifiers in the provided fragment. Returned matches contain `localLine` and `localCol` relative to the fragment.
3. Find the fragment inside the document using `doc.getText().indexOf(code)`. If found, compute a base `start` position and map each match to a `vscode.Position`:
     - For matches on the fragment's first line, add the document's start character offset to the match column (handles fragments that start mid-line).
     - For other lines, use the match's `localCol` directly as the document column.
4. For each identifier position:
     - Query hover information using `vscode.executeHoverProvider(uri, position)` and convert hover contents to plain text.
     - Infer a concise `type` string by preferring patterns like `<name>: <Type>` (matching the identifier name first), then the first `:<something>` pattern, otherwise use the first meaningful hover line. Surrounding quotes/backticks are stripped.
     - Query type/definition locations using `vscode.executeTypeDefinitionProvider(uri, position)` and record any returned `Location` entries as `definitions` objects with `filePath` and `line` (the implementation currently only extracts `Location` and uses `range.start.line`).
5. Append comment(s) to the corresponding line of the fragment. Identical comments are not duplicated on the same line.
6. Return the annotated text and the JSON metadata (two `LanguageModelTextPart`s) on success.

## Hover extraction algorithm
- Execute `vscode.executeHoverProvider(uri, position)` → `Hover[]`.
- Convert each `Hover.contents` entry to plain text (join Markdown/MarkedString parts).
- Try extraction in this order:
    1. Match `<identifier>\s*:\s*([^\n\r]*)` (prefer `name: Type` where `name` is the identifier)
    2. Match first `:\s*([^\n\r]+)` (any colon-separated type)
    3. Otherwise take the first non-empty hover line
- Normalize the extracted text (strip surrounding quotes/backticks) and fall back to tokens such as `<no-hover>` or `<hover-error>` when providers fail or return nothing.

## Cancellation and logging
- The `invoke` method respects a `CancellationToken` and returns early with an error message if cancellation is requested.
- Progress and errors are logged to the extension output channel (`extension.outputChannel`).

## Notes / limitations
- `parseVarMatchesFromText` is a heuristic/regex-based extractor. It handles common patterns (simple declarations, for-of loop variables, basic destructuring, `catch` parameters) but does not fully parse every complex nested destructuring or parameter pattern. For production-accurate extraction, consider using the TypeScript Compiler API.
- The tool currently only annotates the provided fragment text; it does not edit files on disk.

## Testing
- Unit tests should exercise `parseVarMatchesFromText` directly and assert `MatchInfo[]` shapes.
- Integration tests can mock `vscode.workspace.openTextDocument`, hover provider, and type definition provider, then call `AnnotationTool.invoke` and verify the returned annotated text and JSON metadata.

## Suggested improvements
- Use TypeScript AST for robust identifier extraction
- Cache hover/type results to avoid repeated provider calls for the same symbol/position
- Offer an option to apply edits to the file, update existing annotations in-place, or present a preview/diff

## Implementation notes (where to find / key symbols)
- File: `src/lmtools/annotation.ts`
- Input interface: `AnnotationInput` with `filePath` and `code`
- Main method: `async invoke(options: LanguageModelToolInvocationOptions<AnnotationInput>, token: CancellationToken)`
- Success return: `new LanguageModelToolResult([new LanguageModelTextPart(annotatedText), new LanguageModelTextPart(jsonMeta)])`
- Uses `vscode.commands.executeCommand('vscode.executeHoverProvider', uri, position)` and `vscode.commands.executeCommand('vscode.executeTypeDefinitionProvider', uri, position)` to obtain hover/type information and definitions

*/
