import * as vscode from 'vscode'
import { CancellationToken, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult, LanguageModelTextPart, LogOutputChannel, LanguageModelPromptTsxPart } from 'vscode'
import { extractDeclarationsFromUriCode } from './annotationlib/findtokens.js'
import { getDefinitionTextFromUriAtPosition } from './annotationlib/getdefinition.js'
import { renderElementJSON } from '@vscode/prompt-tsx'
import { TypeDefinitionTag } from './toolresult.js'
import * as util from 'node:util'
import { inspectReadable } from '../utils/inspect.js'
import { createLanguageModelPromptTsxPart } from '../utils/prompttsxhelper.js'


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

    const tokens = await extractDeclarationsFromUriCode(uri, text, token)
        if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
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

        for (const t of tokens) {
            if (token.isCancellationRequested) {
                this.extension.outputChannel.debug('[AnnotationTool]: cancelled')
                throw new Error('operation cancelled')
            }

            const startPos = doc.positionAt(textStartInDoc)
            // compute local line/column relative to provided fragment
            const localLine = t.line - startPos.line
            const localCol = localLine === 0 ? t.character - startPos.character : t.character
            const varname = t.varname || ''
            const docLine = startPos.line + localLine
            const docCol = localLine === 0 ? startPos.character + localCol : localCol
            const hoverPos = new vscode.Position(docLine, docCol)

            const typeText = await this.extractTypeFromHoverInfo(hoverPos, uri, varname)

            // attempt to find definition location(s) for the identifier (absolute file path)
            const typeSourceDefinitions = await this.extractTypeSourceDefinitions(hoverPos, uri).catch(e =>
                this.extension.outputChannel.error(`[AnnotationTool]: definition lookup failed for ${varname} - ${util.inspect(e)}`)
            ) ?? []

            const comment = `// ${varname} satisfies ${typeText}`
            const existing = annotationsByLine.get(localLine) || []
            if (!existing.includes(comment)) {
                existing.push(comment)
                annotationsByLine.set(localLine, existing)
            }

            // record metadata for this identifier, include all found definitions if any
            annotationArray.push({
                varname,
                localLine,
                localCol,
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
                typeDefTags.push(createLanguageModelPromptTsxPart(json))
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
        const defs = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeTypeDefinitionProvider', uri, hoverPos) ?? []
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

    private async extractTypeFromHoverInfo(hoverPos: vscode.Position, uri: vscode.Uri, varname: string) {
        let typeText = '<unknown>'
        let hoverText = ''
        try {
            const raw = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, hoverPos)
            if (raw && raw.length > 0) {
                const hoverItems = raw
                hoverText = hoverItems.map(h => {
                    return h.contents.map(c => stringifyHoverContent(c)).filter(s => s.length > 0).join('\n')
                }).join('\n---\n')
                const reVar = new RegExp(escapeRegex(varname) + '\\s*:\\s*([^\\n\\r]*)')
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
                this.extension.outputChannel.error(`[AnnotationTool]: hover failed for ${varname} - ${inspectReadable(e)}`)
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
