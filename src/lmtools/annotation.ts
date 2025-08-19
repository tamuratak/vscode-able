import { CancellationToken, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult, LanguageModelTextPart, LogOutputChannel } from 'vscode'
import * as vscode from 'vscode'
import { MatchInfo, parseVarMatchesFromText } from './annotationlib/annotationparser.js'
import { getDefinitionTextFromUriAtPosition } from './annotationlib/getdefinition.js'


interface AnnotationInput {
    filePath: string,
    code: string,
}

interface Def {
    filePath: string
    startLine: number
    endLine?: number
    definitionText?: string
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
                    } else {
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
                            const defInfo = await getDefinitionTextFromUriAtPosition(defUri, defRange.start)
                            this.extension.outputChannel.debug(`[AnnotationTool]: getDefinitionTextFromUriAtPosition extracts\n${defInfo.text}`)
                            typeSourceDefinitions.push({
                                filePath: defUri.fsPath,
                                startLine: defRange.start.line,
                                endLine: defInfo.endLine,
                                definitionText: defInfo.text,
                            })
                        } catch (e) {
                            this.extension.outputChannel.debug(`[AnnotationTool]: definition text extraction failed for ${m.varname} - ${String(e)}`)
                            typeSourceDefinitions.push({
                                filePath: defUri.fsPath,
                                startLine: defRange.start.line
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
AnnotationTool — concise reference (LLM-oriented)

Purpose
Automatically annotate a provided TypeScript/JavaScript fragment by appending end-of-line comments that show the inferred type for each detected identifier. The tool returns the annotated fragment and a small JSON metadata object; it does not modify files on disk.

Input
- Type: object (see `AnnotationInput`)
- Properties:
    - `filePath`: string — absolute path to the document that contains the fragment
    - `code`: string — the text fragment to analyze (selection)

Output
- On success: a `LanguageModelToolResult` with two `LanguageModelTextPart`s in order:
    1) Annotated source text (original lines with appended comments like `// <varname> satisfies <Type>`)
    2) JSON metadata (pretty-printed) with an `annotations` array describing each identifier
- On failure or early exit: a single-part `LanguageModelToolResult` containing an error string

Metadata (summary)
- Each annotation entry includes:
    - `varname`: identifier string
    - `localLine`, `localCol`: position inside the provided fragment (0-based)
    - `type`: short inferred type text (extracted from hover when available)
    - `definitions` (optional): array of objects with at least `filePath` and `startLine`; may include `endLine` and `definitionText` when the declaration body was extracted
    - `hoverText` (optional): concatenated hover provider contents

High-level behavior
1. Open the document at `filePath` and locate the provided `code` fragment inside it
2. Use `parseVarMatchesFromText(code)` to locate identifier occurrences (returns `MatchInfo[]` with local line/col)
3. Map each match to a `vscode.Position` in the document (first-line matches take the fragment's starting character into account)
4. For each position:
     - Query hover via `vscode.executeHoverProvider` and extract a concise `type` string (prefer `name: Type`, fallback to first `: Type` or first non-empty hover line)
        - Query type/definition locations via `vscode.executeTypeDefinitionProvider` and, when possible, attempt to extract the declaration body using document symbols or by using the provided target range
            (this extraction is performed by `getDefinitionTextFromUriAtPosition` in `src/lmtools/annotationlib/getdefinition.js`).
5. Append unique annotation comments to corresponding fragment lines and collect structured metadata

Assumptions & limitations
- Identifier detection is heuristic and delegated to `parseVarMatchesFromText`; it is not a full TypeScript AST parse
- Declaration extraction relies on language server support for document symbols; when unavailable, the tool falls back to smaller target ranges or omits the declaration text
- The tool requires the exact `code` fragment to appear in the opened document so positions can be computed by direct offset

Example usage (conceptual)
// input: { filePath: '/proj/src/foo.ts', code: 'const x = 1\nconsole.log(x)'}
// output part 1: annotated text with comments
// output part 2: JSON metadata with one annotation for `x`

Where to look
- Implementation: `src/lmtools/annotation.ts`
- Identifier parser: `src/lmtools/annotationlib/annotationparser.js`
- Declaration text helper: `src/lmtools/annotationlib/getdefinition.js`

Notes for LLMs
- This document emphasises intent, input/output shape, and the provider-based inference strategy rather than implementation minutiae. Use the metadata schema and example to construct tool prompts or tests.
*/
