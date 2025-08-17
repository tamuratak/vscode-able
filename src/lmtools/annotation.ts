import { CancellationToken, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult, LanguageModelTextPart, LogOutputChannel } from 'vscode'
import * as vscode from 'vscode'


interface AnnotationInput {
    filePath: string,
    code: string,
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

        const docText = doc.getText()

        // helper to escape regex
        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')

        // patterns to find varnames inside the provided text
        const patterns: { regex: RegExp, kind: 'single' | 'destruct' }[] = [
            { regex: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g, kind: 'single' },
            { regex: /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\b/g, kind: 'single' },
            { regex: /\bfor\s*await\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\b/g, kind: 'single' },
            { regex: /\b(?:const|let|var)\s*\{([^}]+)\}\s*=/g, kind: 'destruct' },
            { regex: /\b(?:const|let|var)\s*\[([^\]]+)\]\s*=/g, kind: 'destruct' },
            { regex: /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g, kind: 'single' }
        ]

        // helper to extract identifiers from destructuring lists
        const extractIdsFromList = (s: string) => {
            return s.split(',')
                .map(p => p.trim())
                .map(p => {
                    // remove default assignments and property renames like "b = 1" or "b: alias"
                    const m = p.match(/^([A-Za-z_$][\w$]*)/) // leading simple identifier
                    if (m) {
                        return m[1]
                    }
                    const m2 = p.match(/:\s*([A-Za-z_$][\w$]*)/)
                    if (m2) {
                        return m2[1]
                    }
                    return null
                })
                .filter(Boolean) as string[]
        }

        interface MatchInfo {
            varname: string
            localLine: number
            localCol: number
            localIndexInText: number
        }
        const matches: MatchInfo[] = []

        const textLines = text.split(/\r?\n/)
        for (let li = 0; li < textLines.length; li++) {
            const line = textLines[li]
            for (const pat of patterns) {
                pat.regex.lastIndex = 0
                let m: RegExpExecArray | null
                while ((m = pat.regex.exec(line)) !== null) {
                    if (pat.kind === 'single') {
                        const varname = m[1]
                        const col = m.index + line.slice(m.index).indexOf(varname)
                        // compute absolute index within the provided text
                        let indexBefore = 0
                        for (let k = 0; k < li; k++) {
                            indexBefore += textLines[k].length + 1
                        }
                        const localIndexInText = indexBefore + m.index
                        matches.push({
                            varname,
                            localLine: li,
                            localCol: col,
                            localIndexInText
                        })
                    } else if (pat.kind === 'destruct') {
                        const list = m[1]
                        const ids = extractIdsFromList(list)
                        for (const id of ids) {
                            const subIndex = line.indexOf(id, m.index)
                            const col = subIndex >= 0 ? subIndex : m.index
                            let indexBefore = 0
                            for (let k = 0; k < li; k++) {
                                indexBefore += textLines[k].length + 1
                            }
                            const localIndexInText = indexBefore + (subIndex >= 0 ? subIndex : m.index)
                            matches.push({
                                varname: id,
                                localLine: li,
                                localCol: col,
                                localIndexInText
                            })
                        }
                    }
                }
            }
        }

        if (matches.length === 0) {
            this.extension.outputChannel.debug('[AnnotationTool]: no variable occurrences found in provided text')
            return this.errorResponse('no variable occurrences found in provided text')
        }

        const textStartInDoc = docText.indexOf(text)
        if (textStartInDoc >= 0) {
            this.extension.outputChannel.debug('[AnnotationTool]: found provided text in document; using direct offsets for hover positions')
        } else {
            this.extension.outputChannel.debug('[AnnotationTool]: provided text not found in document; will fallback to searching variable occurrences in the document')
        }

        const annotationsByLine: Map<number, string[]> = new Map<number, string[]>()

        for (const m of matches) {
            if (token.isCancellationRequested) {
                this.extension.outputChannel.debug('[AnnotationTool]: cancelled')
                return this.errorResponse('operation cancelled')
            }

            let hoverPos: vscode.Position | undefined

            if (textStartInDoc >= 0) {
                const startPos = doc.positionAt(textStartInDoc)
                const docLine = startPos.line + m.localLine
                const docCol = m.localCol
                hoverPos = new vscode.Position(docLine, docCol)
            } else {
                const re = new RegExp('\\b' + escapeRegex(m.varname) + '\\b', 'g')
                const found = re.exec(docText)
                if (found && typeof found.index === 'number') {
                    const pos = doc.positionAt(found.index)
                    hoverPos = new vscode.Position(pos.line, pos.character)
                } else {
                    hoverPos = undefined
                }
            }

            let typeText = '<unknown>'
            if (hoverPos) {
                try {
                    const raw = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, hoverPos)
                    if (Array.isArray(raw) && raw.length > 0) {
                        const hoverItems = raw
                        const hoverText = hoverItems.map(h => {
                            const contents = Array.isArray(h.contents) ? h.contents : [h.contents]
                            return contents.map(c => typeof c === 'string' ? c : (c.value || '')).join('\n')
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
            } else {
                this.extension.outputChannel.debug(`[AnnotationTool]: no document position found for ${m.varname}`)
                typeText = '<no-position>'
            }

            typeText = typeText.replace(/^['"`]+|['"`]+$/g, '').trim()

            const comment = `// ${m.varname} satisfies ${typeText}`
            const existing = annotationsByLine.get(m.localLine) || []
            if (!existing.includes(comment)) {
                existing.push(comment)
                annotationsByLine.set(m.localLine, existing)
            }
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

        this.extension.outputChannel.debug(`[AnnotationTool]: \n${annotatedText}`)
        return new LanguageModelToolResult([new LanguageModelTextPart(annotatedText)])

    }

}

/**

# AnnotationTool — English reference (Markdown)

## Purpose
Automatically annotate a given TypeScript code fragment by appending comments that show the inferred type for each variable occurrence. The tool returns the annotated code as a string (no file writes).

## Input (shape)
- Type: object
- Properties:
  - `filePath`: string — absolute path to the target file
  - `code`: string — the TypeScript code fragment to analyze (the selection)
- Required: `filePath`, `code`

(Encapsulated in the extension as `AnnotationInput`)

## Output (shape)
- A `LanguageModelToolResult` containing a single `LanguageModelTextPart` whose text is the annotated code string.
- Annotation format appended to lines:
  - `// <varname> satisfies <Type>`

## High-level behavior
1. Open the document at `filePath`.
2. Split the provided `code` into lines and scan each line for variable occurrences using a set of patterns (see below).
3. For each detected variable, map to a document position:
   - If the provided `code` exactly occurs in the document, map lines/columns relative to that occurrence
   - Otherwise, fallback to searching the document for the identifier occurrence (first match)
4. Use the hover provider to obtain type info:
   - Call `vscode.executeHoverProvider(uri, position)` to get hover items
   - Convert hover contents to plain text
   - Prefer patterns like `<name>: <Type>`; otherwise pick the first meaningful hover line
5. Append comment(s) to the corresponding line in the provided `code`:
   - Avoid duplicating identical comments
6. Return the new annotated code as the tool result (no file edits)

## Detection patterns (implemented)
- simple declarations:
  - `const|let|var <identifier> = ...`
  - regex: `/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g`
- for-of loops:
  - `for (const|let|var <identifier> of ...)`
  - regex: `/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\b/g`
- async iteration:
  - `for await (const|let|var <identifier> of ...)`
  - regex: `/\bfor\s*await\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\b/g`
- destructuring (object):
  - `const { a, b: alias } = ...`
  - regex: `/\b(?:const|let|var)\s*\{([^}]+)\}\s*=/g` (then split and extract identifiers)
- destructuring (array):
  - `const [x, , y] = ...`
  - regex: `/\b(?:const|let|var)\s*\[([^\]]+)\]\s*=/g` (then split and extract identifiers)
- `catch` parameter:
  - `catch (err)` — regex: `/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g`

Notes:
- Destructuring extraction is text-based (comma-splitting, remove `: alias` and defaults). Nested or very complex destructuring is not fully parsed by the current implementation.

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

## Limitations
- Destructuring parsing is heuristic and can miss nested destructuring or rest patterns
- Mapping `code` to precise document position can be ambiguous if `code` occurs multiple times — implementation currently uses the first match
- Hover content format depends on the language server and may vary; extraction falls back to the best available line
- Performance: many hover calls for large selections; no batching/cache currently
- Does not analyze function parameters, class fields, import bindings, or reassignments (unless added)

## Suggested improvements
- Use the TypeScript AST (Compiler API) to extract identifiers precisely (handles nested destructuring, parameters, class fields, etc.) — recommended for robustness
- Cache hover results by identifier/position to reduce repeated calls
- Provide an option to apply edits to the file, update existing annotations, or show a preview/diff
- Improve position mapping to prefer matches closest to the selection or to accept more precise offsets if multiple occurrences exist

## Implementation notes (where to find / key symbols)
- File: `src/lmtools/annotation.ts`
- Input interface: `AnnotationInput` with `filePath` and `code`
- Main method: `async invoke(options: LanguageModelToolInvocationOptions<AnnotationInput>, token: CancellationToken)`
- Returns: `new LanguageModelToolResult([new LanguageModelTextPart(annotatedText)])`
- Uses `vscode.commands.executeCommand('vscode.executeHoverProvider', uri, position)` to obtain type info

*/
