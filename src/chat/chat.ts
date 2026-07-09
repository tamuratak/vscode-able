import * as vscode from 'vscode'
import { FluentJaPrompt, FluentPrompt, ProperNounsPrompt, SimplePrompt, ToEnPrompt, ToJaPrompt, ChatCommandPromptProps } from './prompt.js'
import type { PromptElementCtor } from '@vscode/prompt-tsx'
import { CopilotChatHandler } from './chatlib/copilotchathandler.js'
import { FileReference, getSelected, processReferences } from './chatlib/referenceutils.js'
import { debugObj } from '../utils/debug.js'
import { convertMathEnv, removeLabel } from './chatlib/latex.js'
import { toCunks } from './chatlib/chunk.js'
import { countLinesContained, extractProperNouns, parseNameMap, removePluralForms, selectProperNounsInEnglish } from './chatlib/nlp.js'
import { browserPromise } from '../fetchwebpage/browser.js'
import { getFullAXTree } from '../fetchwebpage/axtree.js'
import { AXNode, convertAXTreeToMarkdown } from '../fetchwebpage/cdpaccessibilitydomain.js'
import { doFixMath } from './fixmathlib/fix.js'
import { textToPatch, patchToCommit, identifyFilesAffected, stripCodeBlockFences } from '../applypatch/parser.js'
import { ActionType, DiffError, InvalidContextError, InvalidPatchFormatError, type Patch, type Commit } from '../applypatch/types.js'
import path from 'node:path'


export type RequestCommands = 'fluent' | 'fluent_ja' | 'to_en' | 'to_ja'

export class ChatHandleManager {
    private readonly copilotChatHandler: CopilotChatHandler

    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) {
        this.copilotChatHandler = new CopilotChatHandler(extension)
    }

    getHandler(): vscode.ChatRequestHandler {
        return async (
            request: vscode.ChatRequest,
            _context: vscode.ChatContext,
            stream: vscode.ChatResponseStream,
            token: vscode.CancellationToken
        ): Promise<vscode.ChatResult | undefined> => {
            debugObj('[Able Chat] request.references: ', request.references, this.extension.outputChannel)
            const { files, selections, instructionsText } = await processReferences(request.references)
            if (request.command) {
                return this.responseForCommand(request, files, stream, token)
            } else {
                const modeInstruction = request.modeInstructions2?.content
                await this.copilotChatHandler.copilotChatResponse(
                    token,
                    SimplePrompt,
                    { input: request.prompt, selections, attachments: files, instructionsText, modeInstruction },
                    request.model,
                    stream
                )
                return
            }
        }
    }

    private async responseForCommand(
        request: vscode.ChatRequest,
        files: FileReference[],
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
    ): Promise<vscode.ChatResult | undefined> {
        const model = request.model
        const selected = await getSelected(request)
        const input = selected?.text ?? request.prompt
        let ctor: PromptElementCtor<ChatCommandPromptProps, unknown> | undefined
        let properNounsTranslationMap: Map<string, string> | undefined
        if (request.command === 'fluent') {
            ctor = FluentPrompt
        } else if (request.command === 'fluent_ja') {
            ctor = FluentJaPrompt
        } else if (request.command === 'to_en') {
            ctor = ToEnPrompt
        } else if (request.command === 'to_ja') {
            properNounsTranslationMap = await this.extractTranslationMapForToJa(token, request, input)
            ctor = ToJaPrompt
        } else if (request.command === 'fetch') {
            await this.fetchWebPageAndOutput(request, files, stream)
            return
        } else if (request.command === 'fixmath') {
            await this.fixMathFormatting(files, stream)
            return
        } else if (request.command === 'apply_patch') {
            await this.applyPatchCommand(request.prompt, files, stream)
            return
        } else {
            this.extension.outputChannel.error(`Unknown command: ${request.command}`)
            throw new Error(`Unknown command: ${request.command}`)
        }

        const responseTextArray: string[] = []
        const userInstruction = selected ? request.prompt : undefined
        const chunks = toCunks(input, 1024)
        for (const inputChunk of chunks) {
            stream.markdown('---\n')
            let translationCorrespondenceList: string | undefined
            if (request.command === 'to_ja' && properNounsTranslationMap) {
                translationCorrespondenceList = this.generateTranslationListForToJa(properNounsTranslationMap, inputChunk)
                stream.markdown('### Detected Proper Nouns\n' + translationCorrespondenceList)
            }
            let res: {
                chatResponse: vscode.LanguageModelChatResponse;
            } | undefined
            let responseChunk: string | undefined
            for (let i = 0; i < 2; i++) {
                res = await this.copilotChatHandler.copilotChatResponse(
                    token,
                    ctor,
                    {
                        input: inputChunk,
                        userInstruction,
                        translationCorrespondenceList,
                    },
                    model
                )
                if (res) {
                    responseChunk = await processResponse(res.chatResponse)
                    if (request.command === 'to_ja') {
                        if (this.validateResponseChunkForToJa(inputChunk, responseChunk)) {
                            break
                        }
                        this.extension.outputChannel.info('Re-translation needed')
                    } else {
                        break
                    }
                }
            }
            if (!responseChunk) {
                throw new Error('No response from LLM')
            }
            if (selected) {
                const formattedChatOutput = '#### input\n' + this.tweakResponse(inputChunk) + '\n\n' + '#### output\n' + this.tweakResponse(responseChunk) + '\n\n'
                stream.markdown(formattedChatOutput)
            } else {
                stream.markdown(responseChunk)
                stream.markdown('\n\n')
            }
            responseTextArray.push(responseChunk)
        }
        if (selected) {
            const edit = new vscode.TextEdit(selected.range, responseTextArray.join('\n\n'))
            const uri = selected.uri
            stream.textEdit(uri, edit)
            return
        }
        return
    }

    private async extractTranslationMapForToJa(
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        input: string
    ): Promise<Map<string, string>> {
        const extractedProperNouns = extractProperNouns(input)
        const properNouns = removePluralForms(extractedProperNouns)
        const properNounsResult = await this.copilotChatHandler.copilotChatResponse(token, ProperNounsPrompt, { properNouns }, request.model)
        const properNounsText = properNounsResult ? await processResponse(properNounsResult.chatResponse) : ''
        return parseNameMap(properNounsText)
    }

    private generateTranslationListForToJa(
        properNounsTranslationMap: Map<string, string>,
        inputChunk: string
    ): string {
        const selectedProperNouns = selectProperNounsInEnglish(properNounsTranslationMap, inputChunk)
        let selectedProperNounsStr = ''
        for (const [k, v] of selectedProperNouns) {
            selectedProperNounsStr += `- ${k}: ${v}\n`
        }
        return selectedProperNounsStr
    }

    private validateResponseChunkForToJa(inputChunk: string, responseChunk: string): boolean {
        return countLinesContained(inputChunk, responseChunk) === 0
    }

    private tweakResponse(text: string): string {
        text = convertMathEnv(text)
        text = removeLabel(text)
        return text
    }

    private async fetchWebPageAndOutput(
        request: vscode.ChatRequest,
        files: FileReference[],
        stream: vscode.ChatResponseStream
    ) {
        stream.progress('Fetching web page...')
        try {
            const browser = await browserPromise
            const targetUriString = request.prompt.trim()
            const uri = vscode.Uri.parse(targetUriString, true)
            if (uri.scheme === 'file') {
                stream.markdown('file: URLs are not supported for security reasons')
                return
            }
            const result = await getFullAXTree(browser, targetUriString)
            const md = convertAXTreeToMarkdown(uri, result.nodes as unknown as AXNode[])
            const outputFile = files.find(f => f.kind === 'file' && vscode.workspace.getWorkspaceFolder(f.uri))
            if (outputFile) {
                stream.textEdit(outputFile.uri, new vscode.TextEdit(new vscode.Range(0, 0, Number.MAX_VALUE, Number.MAX_VALUE), md))
            } else {
                stream.markdown(md)
            }
        } catch {
            stream.markdown('Failed to fetch web page.')
        }
    }

    private async fixMathFormatting(
        files: FileReference[],
        stream: vscode.ChatResponseStream,
    ) {
        const attachments = files.filter(ref => ref.kind === 'file' && vscode.workspace.getWorkspaceFolder(ref.uri))
        const decoder = new TextDecoder()
        for (const attachment of attachments) {
            const uri = attachment.uri
            try {
                const buf = await vscode.workspace.fs.readFile(uri)
                const content = decoder.decode(buf)
                const fixedContent = doFixMath(content)
                const edit = new vscode.TextEdit(
                    new vscode.Range(
                        new vscode.Position(0, 0),
                        new vscode.Position(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
                    ),
                    fixedContent
                )
                stream.textEdit(uri, edit)
            } catch {
                stream.markdown(`Failed to read or process file ${uri.toString()}`)
            }
        }
        return
    }

    private async applyPatchCommand(
        prompt: string,
        attachedFiles: FileReference[],
        stream: vscode.ChatResponseStream,
    ): Promise<void> {
        let patchText: string
        try {
            patchText = stripCodeBlockFences(prompt)
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Unknown error'
            stream.markdown(`Error: ${msg}

`)
            return
        }

        const workspaceFolders = vscode.workspace.workspaceFolders
        if (!workspaceFolders || workspaceFolders.length === 0) {
            stream.markdown('Error: No workspace folder is open.')
            return
        }

        const affectedPaths = identifyFilesAffected(patchText)
        const activeFileUri = vscode.window.activeTextEditor?.document.uri
        const filePaths = await this.resolveFilePaths(affectedPaths, workspaceFolders, attachedFiles, activeFileUri)

        const unresolvedPaths = affectedPaths.filter(p => !filePaths.has(p))
        if (unresolvedPaths.length > 0) {
            stream.markdown(`Error: The following files were not found in the workspace:\n\n${unresolvedPaths.map(p => `- \`${p}\``).join('\n')}\n\n`)
            if (filePaths.size === 0) {
                return
            }
        }

        const currentFiles: Record<string, string> = {}
        for (const [relativePath, uri] of filePaths) {
            try {
                const buf = await vscode.workspace.fs.readFile(uri)
                currentFiles[relativePath] = new TextDecoder().decode(buf)
            } catch {
                stream.markdown(`Error: Failed to read file: \`${relativePath}\`\n\n`)
                filePaths.delete(relativePath)
            }
        }

        if (filePaths.size === 0) {
            stream.markdown('Error: No files could be read.')
            return
        }

        let patch: Patch
        try {
            [patch] = textToPatch(patchText, currentFiles)
        } catch (error) {
            const oc = this.extension.outputChannel
            oc.error(`[apply_patch] patchText:\n${patchText}`)
            for (const [k, v] of Object.entries(currentFiles)) {
                oc.error(`[apply_patch] currentFiles["${k}"] (first 500 chars):\n${v.slice(0, 500)}`)
            }
            if (error instanceof Error) {
                oc.error(`[apply_patch] error stack: ${error.stack}`)
            }
            if (error instanceof InvalidContextError) {
                const contextLineRange = Math.min(error.contextLines.length, 5)
                const contextLabel = error.contextLines.length > contextLineRange
                    ? ` (first ${contextLineRange} of ${error.contextLines.length} lines)`
                    : ''
                stream.markdown('**Context mismatch** — patch could not find expected lines in the file.\n\n')
                stream.markdown(`**File**: \`${error.filePath}\`  \n`)
                stream.markdown(`**Near line**: ${error.lineIndex + 1}  \n`)
                stream.markdown(`**Patch expected${contextLabel}:**\n`)
                stream.markdown('\n````\n' + error.contextLines.slice(0, contextLineRange).join('\n') + '\n````\n\n')
                stream.markdown(`**Reason**: ${error.kindForTelemetry}\n\n`)
            } else if (error instanceof InvalidPatchFormatError) {
                stream.markdown(`**Invalid patch format**: ${error.message}\n\n`)
            } else if (error instanceof DiffError) {
                stream.markdown(`**Patch error**: ${error.message}\n\n`)
            } else {
                stream.markdown('Unexpected error parsing patch.\n\n')
            }
            return
        }

        let commit: Commit
        try {
            commit = patchToCommit(patch, currentFiles)
        } catch (error) {
            if (error instanceof DiffError) {
                stream.markdown(`Error applying patch: ${error.message}\n\n`)
            } else {
                stream.markdown('Unexpected error applying patch.\n\n')
            }
            return
        }

        const appliedFiles: string[] = []
        for (const [relativePath, change] of Object.entries(commit.changes)) {
            const uri = filePaths.get(relativePath)
            if (!uri) {
                continue
            }

            if (change.type === ActionType.DELETE) {
                stream.markdown(`Note: \`${relativePath}\` is marked for deletion. Please delete the file manually.\n\n`)
            } else if (change.type === ActionType.ADD) {
                stream.markdown(`Note: \`${relativePath}\` is a new file. Adding files is not supported in this command. Please create the file manually.\n\n`)
            } else if (change.type === ActionType.UPDATE) {
                if (change.movePath) {
                    stream.markdown(`Note: \`${relativePath}\` is marked for move to \`${change.movePath}\`. Moving files is not supported in this command. Please move the file manually.\n\n`)
                } else {
                    // Each file has at most one FileChange in the Commit (see patchToCommit),
                    // so this TextEdit is emitted once per file. The full-range replacement
                    // ensures that multiple hunks from the same patch are applied atomically.
                    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
                    stream.textEdit(uri, new vscode.TextEdit(range, change.newContent ?? ''))
                    appliedFiles.push(relativePath)
                }
            }
        }

        if (appliedFiles.length > 0) {
            stream.markdown(`Applied patch to ${appliedFiles.length} file(s): ${appliedFiles.map(f => `\`${f}\``).join(', ')}`)
        }
    }

    private async resolveFilePaths(
        relativePaths: string[],
        workspaceFolders: readonly vscode.WorkspaceFolder[],
        attachedFiles: FileReference[],
        activeFileUri: vscode.Uri | undefined,
    ): Promise<Map<string, vscode.Uri>> {
        const result = new Map<string, vscode.Uri>()

        // Build a basename index for attached files (first match wins)
        const attachedByBasename = new Map<string, vscode.Uri>()
        for (const ref of attachedFiles) {
            if (ref.kind !== 'file') {
                continue
            }
            const basename = path.basename(ref.uri.path)
            if (!attachedByBasename.has(basename)) {
                attachedByBasename.set(basename, ref.uri)
            }
        }

        const activeBasename = activeFileUri ? path.basename(activeFileUri.path) : undefined

        for (const relativePath of relativePaths) {
            const basename = path.basename(relativePath)

            // 1. Check attached files by basename
            const attachedUri = attachedByBasename.get(basename)
            if (attachedUri) {
                result.set(relativePath, attachedUri)
                continue
            }

            // 2. Check active file by basename
            if (activeBasename === basename && activeFileUri) {
                result.set(relativePath, activeFileUri)
                continue
            }

            // 3. Try direct stat against each workspace folder
            let found = false
            for (const folder of workspaceFolders) {
                const uri = vscode.Uri.joinPath(folder.uri, relativePath)
                try {
                    await vscode.workspace.fs.stat(uri)
                    result.set(relativePath, uri)
                    found = true
                    break
                } catch {
                    // not found in this folder, try next
                }
            }
            if (found) {
                continue
            }

            // 4. Fallback: glob search by basename
            const globPattern = `**/${basename}`
            const matches = await vscode.workspace.findFiles(globPattern, undefined, 1)
            if (matches.length > 0) {
                result.set(relativePath, matches[0])
            }
        }

        return result
    }

}

async function processResponse(response: vscode.LanguageModelChatResponse) {
    let responseStr = ''
    for await (const fragment of response.text) {
        responseStr += fragment
    }
    return responseStr
}
