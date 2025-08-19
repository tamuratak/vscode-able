import * as vscode from 'vscode'
import { CancellationToken, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult, LanguageModelTextPart, LogOutputChannel, LanguageModelPromptTsxPart } from 'vscode'
import { MatchInfo, parseVarMatchesFromText } from './annotationlib/annotationparser.js'
import { getDefinitionTextFromUriAtPosition } from './annotationlib/getdefinition.js'
import { renderElementJSON } from '@vscode/prompt-tsx'
import { TypeDefinitionTag } from './toolresult.js'
import * as util from 'node:util'
import { inspectReadable } from '../utils/inspect.js'


interface AnnotationToolInput {
    filePath: string,
    code: string,
}

export interface DefinitionMetadata {
    name?: string
    filePath: string
    startLine: number
    endLine?: number
    definitionText?: string
}

interface AnnotationInfo {
    varname: string
    localLine: number
    localCol: number
    type: string
    definitions?: DefinitionMetadata[] | undefined
}

export const annotationToolName = 'able_annotation'

export class AnnotationTool implements LanguageModelTool<AnnotationToolInput> {

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

    async invoke(options: LanguageModelToolInvocationOptions<AnnotationToolInput>, token: CancellationToken) {
        const { filePath, code: text } = options.input
        const uri = vscode.Uri.file(filePath)
        this.extension.outputChannel.debug(`[AnnotationTool]: invoke on ${filePath}`)

        let doc: vscode.TextDocument
        try {
            doc = await vscode.workspace.openTextDocument(uri)
        } catch (e) {
            this.extension.outputChannel.error(`[AnnotationTool]: cannot open document: ${inspectReadable(e)}`)
            return this.errorResponse(`failed to open document at ${filePath}`)
        }

        const matches: MatchInfo[] = parseVarMatchesFromText(text)
        if (matches.length === 0) {
            this.extension.outputChannel.debug('[AnnotationTool]: no variable occurrences found in provided text')
            return this.errorResponse('no variable occurrences found in provided text')
        }

        const docString = doc.getText()
        const textStartInDoc = docString.indexOf(text)
        if (textStartInDoc < 0) {
            this.extension.outputChannel.debug('[AnnotationTool]: provided text not found in document')
            return this.errorResponse('provided text not found in document')
        }

        const annotationsByLine: Map<number, string[]> = new Map<number, string[]>()
        const annotationArray: AnnotationInfo[] = []

        for (const m of matches) {
            if (token.isCancellationRequested) {
                this.extension.outputChannel.debug('[AnnotationTool]: cancelled')
                throw new Error('operation cancelled')
            }

            const startPos = doc.positionAt(textStartInDoc)
            const docLine = startPos.line + m.localLine
            // If the match is on the first line of the fragment, add the start character offset
            // to account for the fragment starting mid-line in the document
            const docCol = m.localLine === 0 ? startPos.character + m.localCol : m.localCol
            const hoverPos = new vscode.Position(docLine, docCol)

            const typeText = await this.extractTypeFromHoverInfo(hoverPos, uri, m)

            // attempt to find definition location(s) for the identifier (absolute file path)
            const typeSourceDefinitions = await this.extractTypeSourceDefinitions(hoverPos, uri).catch(e =>
                this.extension.outputChannel.error(`[AnnotationTool]: definition lookup failed for ${m.varname} - ${util.inspect(e)}`)
            ) ?? []

            const comment = `// ${m.varname} satisfies ${typeText}`
            const existing = annotationsByLine.get(m.localLine) || []
            if (!existing.includes(comment)) {
                existing.push(comment)
                annotationsByLine.set(m.localLine, existing)
            }

            // record metadata for this identifier, include all found definitions if any
            annotationArray.push({
                varname: m.varname,
                localLine: m.localLine,
                localCol: m.localCol,
                type: typeText,
                definitions: typeSourceDefinitions.length > 0 ? typeSourceDefinitions : undefined
            })
        }

        const textLines = text.split(/\r?\n/)
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

        const renderedFilePathSet = new Set<string>()
        const typeDefTags: LanguageModelPromptTsxPart[] = []
        for (const anno of annotationArray) {
            for (const def of anno.definitions || []) {
                if (this.shouldSkip(def) || renderedFilePathSet.has(def.filePath)) {
                    continue
                }
                const json = await renderElementJSON(
                    TypeDefinitionTag,
                    { definitionMetadata: def },
                    options.tokenizationOptions
                )
                renderedFilePathSet.add(def.filePath)
                typeDefTags.push(new LanguageModelPromptTsxPart(json))
            }
        }

        const annotatedText = outLines.join('\n')
        return new LanguageModelToolResult([
            new LanguageModelTextPart(annotatedText),
            ...typeDefTags
        ])
    }

    private shouldSkip(def: DefinitionMetadata) {
        return def.filePath.includes('node_modules/@types/node/') || def.filePath.includes('node_modules/typescript/lib/')
    }
    // attempt to find definition location(s) for the identifier (absolute file path)
    private async extractTypeSourceDefinitions(hoverPos: vscode.Position, uri: vscode.Uri) {
        const typeSourceDefinitions: DefinitionMetadata[] = []
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
                    typeSourceDefinitions.push({
                        name: defInfo.name,
                        filePath: defUri.fsPath,
                        startLine: defRange.start.line,
                        endLine: defInfo.endLine,
                        definitionText: defInfo.text,
                    })
                } catch (e) {
                    this.extension.outputChannel.error(`[AnnotationTool]: definition text extraction failed: ${inspectReadable(e)}`)
                    typeSourceDefinitions.push({
                        filePath: defUri.fsPath,
                        startLine: defRange.start.line
                    })
                }
            }
        }
        return typeSourceDefinitions
    }

    private async extractTypeFromHoverInfo(hoverPos: vscode.Position, uri: vscode.Uri, m: MatchInfo) {
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
            this.extension.outputChannel.error(`[AnnotationTool]: hover failed for ${m.varname} - ${inspectReadable(e)}`)
            typeText = '<hover-error>'
        }
        typeText = typeText.replace(/^['"`]+|['"`]+$/g, '').trim()
        return typeText
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
Provide a compact, machine-friendly summary of the AnnotationTool: it annotates a provided TypeScript/JavaScript text fragment by appending end-of-line comments that state the inferred type for each detected identifier. The tool does not modify disk files; it returns the annotated fragment and optional structured metadata for use by LLMs or tooling.

Inputs
- Type: object
- Properties:
    - `filePath`: string — absolute path to the containing document
    - `code`: string — the exact text fragment (selection) present inside that document

Outputs
- Success: a LanguageModelToolResult whose first part is the annotated source text (original lines with appended comments, e.g. `// x satisfies number`) and subsequent parts are optional serialized TypeDefinition entries (TSX prompt parts) for discovered definitions
- Failure: a single-part LanguageModelToolResult containing an error string

Annotation metadata (per-identifier)
- `varname`: identifier name
- `localLine`, `localCol`: 0-based position inside the provided `code` fragment
- `type`: concise inferred type string (extracted from hover provider when available)
- `definitions` (optional): array of objects with at minimum `{ filePath, startLine }` and optionally `{ endLine, name, definitionText }`

Minimal behaviour summary
1) Open `filePath` and locate the exact `code` fragment inside the document
2) Extract identifier matches with `parseVarMatchesFromText(code)` (returns MatchInfo[] containing local line/col)
3) Convert each match to a document `vscode.Position` and request hover information (`vscode.executeHoverProvider`) to derive a short `type` string
4) Request type/definition locations (`vscode.executeTypeDefinitionProvider`) and, when possible, extract the full declaration text using document symbols via `getDefinitionTextFromUriAtPosition`
5) Produce annotated lines (append unique `// <var> satisfies <Type>` comments) and return structured metadata plus any serialized type-definition prompt parts

Assumptions and limitations
- Identifier detection is heuristic (not a full AST) and depends on `annotationparser.js`
- Declaration extraction depends on language-server support for document symbols and type-definition providers; missing support reduces metadata richness
- The provided `code` must match text in the opened document for positions to be computed accurately

Example (conceptual)
Input: { filePath: '/proj/src/foo.ts', code: 'const x = 1\nconsole.log(x)' }
Output part 1: annotated text with `// x satisfies number` appended to the console line
Output part 2: optional serialized type-definition entries for discovered symbols

Where to inspect implementation
- Implementation: `src/lmtools/annotation.ts`
- Identifier parser: `src/lmtools/annotationlib/annotationparser.js`
- Declaration extractor: `src/lmtools/annotationlib/getdefinition.js`

*/
