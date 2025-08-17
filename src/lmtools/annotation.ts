import { CancellationToken, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult, LanguageModelTextPart, LogOutputChannel } from 'vscode'
import * as vscode from 'vscode'
// debugObj intentionally not used here


export interface AnnotationInput {
    filePath: string,
    text: string,
}

export class AnnotationTool implements LanguageModelTool<AnnotationInput> {

    constructor(
        private readonly extension: {
            readonly outputChannel: LogOutputChannel
        }
    ) {
        this.extension.outputChannel.info('[AnnotationTool]: AnnotationTool created')
    }

    prepareInvocation(_options: vscode.LanguageModelToolInvocationPrepareOptions<AnnotationInput>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
        // No special prepare step for now
        return undefined
    }

    async invoke(options: LanguageModelToolInvocationOptions<AnnotationInput>, token: CancellationToken) {
        const { filePath, text } = options.input
        const uri = vscode.Uri.file(filePath)
        this.extension.outputChannel.info(`[AnnotationTool]: invoke on ${filePath}`)

        let doc: vscode.TextDocument
        try {
            doc = await vscode.workspace.openTextDocument(uri)
        } catch (e) {
            this.extension.outputChannel.error(`[AnnotationTool]: cannot open document: ${String(e)}`)
            throw new Error(`[AnnotationTool]: Failed to open document at ${filePath}`)
        }

        const docText = doc.getText()

        // helper to escape regex
        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')

        // patterns to find varnames inside the provided text
        const patterns: RegExp[] = [
            /\bconst\s+([A-Za-z_$][\w$]*)\s*=/g,
            /\bfor\s*\(\s*const\s+([A-Za-z_$][\w$]*)\s+of\b/g
        ]

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
                pat.lastIndex = 0
                let m: RegExpExecArray | null
                while ((m = pat.exec(line)) !== null) {
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
                }
            }
        }

        if (matches.length === 0) {
            this.extension.outputChannel.info('[AnnotationTool]: no variable occurrences found in provided text')
            return new LanguageModelToolResult([new LanguageModelTextPart(text)])
        }

        const textStartInDoc = docText.indexOf(text)
        if (textStartInDoc >= 0) {
            this.extension.outputChannel.info('[AnnotationTool]: found provided text in document; using direct offsets for hover positions')
        } else {
            this.extension.outputChannel.info('[AnnotationTool]: provided text not found in document; will fallback to searching variable occurrences in the document')
        }

        const annotationsByLine: Map<number, string[]> = new Map<number, string[]>()

        for (const m of matches) {
            if (token.isCancellationRequested) {
                this.extension.outputChannel.info('[AnnotationTool]: cancelled')
                return new LanguageModelToolResult([new LanguageModelTextPart(text)])
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
                this.extension.outputChannel.info(`[AnnotationTool]: no document position found for ${m.varname}`)
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
        this.extension.outputChannel.info('[AnnotationTool]: building annotated text complete')

        return new LanguageModelToolResult([new LanguageModelTextPart(annotatedText)])

    }

}
