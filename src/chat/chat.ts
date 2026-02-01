import * as vscode from 'vscode'
import { FluentJaPrompt, FluentPrompt, ProperNounsPrompt, SimplePrompt, ToEnPrompt, ToJaPrompt, ChatCommandPromptProps } from './prompt.js'
import type { PromptElementCtor } from '@vscode/prompt-tsx'
import { CopilotChatHandler } from './chatlib/copilotchathandler.js'
import { getSelected, processReferences } from './chatlib/referenceutils.js'
import { debugObj } from '../utils/debug.js'
import { convertMathEnv, removeLabel } from './chatlib/latex.js'
import { toCunks } from './chatlib/chunk.js'
import { countLinesContained, extractProperNouns, parseNameMap, removePluralForms, selectProperNounsInEnglish } from './chatlib/nlp.js'


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
            if (request.command) {
                return this.responseForCommand(token, request, stream)
            } else {
                const { files, selections, instructionsText} = await processReferences(request.references)

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
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
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

}

async function processResponse(response: vscode.LanguageModelChatResponse) {
    let responseStr = ''
    for await (const fragment of response.text) {
        responseStr += fragment
    }
    return responseStr
}
