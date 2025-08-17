import { LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelTextPart, LanguageModelToolCallPart, LanguageModelToolResultPart, LanguageModelToolResultPart2, LanguageModelDataPart, LanguageModelPromptTsxPart, LanguageModelToolResult } from 'vscode'
import { createByModelName, TikTokenizer } from '@microsoft/tiktokenizer'
import { ExternalPromise } from '../../../utils/externalpromise.js'
import { renderToolResult } from '../../../utils/toolresultrendering.js'

const tokenizerPromise = new ExternalPromise<TikTokenizer>()

async function initTokenizer() {
    // The BPE rank file will be automatically downloaded and saved to node_modules/@microsoft/tiktokenizer/model if it does not exist.
    tokenizerPromise.resolve(await createByModelName('gpt-4o'))
}

async function encodeLen(s: string) {
    const tokenizer: TikTokenizer = await tokenizerPromise.promise
    return tokenizer.encode(s).length
}

export async function tokenLength(text: string | LanguageModelChatMessage | LanguageModelChatMessage2): Promise<number> {
    const tokensPerMessage = 3
    const tokensPerName = 1
    let numTokens = tokensPerMessage
    if (typeof text === 'string') {
        numTokens += await encodeLen(text)
        return numTokens
    }
    if (text.name) {
        numTokens += tokensPerName
    }
    for (const part of text.content) {
        if (part instanceof LanguageModelTextPart) {
            numTokens += await encodeLen(part.value)
        } else if ((part instanceof LanguageModelToolResultPart) || (part instanceof LanguageModelToolResultPart2)) {
            numTokens += tokensPerName
            const contents = part.content.filter(c => c instanceof LanguageModelTextPart || c instanceof LanguageModelPromptTsxPart)
            const toolResult = new LanguageModelToolResult(contents)
            const content = await renderToolResult(toolResult)
            numTokens += await encodeLen(content)
        } else if (part instanceof LanguageModelToolCallPart) {
            // Count callId, name and the serialized input
            numTokens += tokensPerName
            numTokens += await encodeLen(part.callId)
            numTokens += tokensPerName
            numTokens += await encodeLen(part.name)
            numTokens += await encodeLen(JSON.stringify(part.input))
        } else {
            part satisfies LanguageModelDataPart
            // skip
        }
    }
    return numTokens
}


void initTokenizer()
