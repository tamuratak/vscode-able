import {
    createByModelName,
    TikTokenizer,
} from '@microsoft/tiktokenizer'
import { ITokenizer } from '@vscode/prompt-tsx'
import { BaseTokensPerMessage, BaseTokensPerName, ChatMessage, ChatRole } from '@vscode/prompt-tsx/dist/base/openai'
import { ExternalPromise } from '../utils/externalpromise.js'


export class Gpt4oTokenizer implements ITokenizer {
    private readonly _tokenizer = new ExternalPromise<TikTokenizer>()
    private readonly baseTokensPerMessage = BaseTokensPerMessage
    private readonly baseTokensPerName = BaseTokensPerName

    constructor() {
        void this.initTokenizer()
    }

    private async tokenize(text: string) {
        const tokenizer = await this._tokenizer.promise
        return tokenizer.encode(text)
    }

    async tokenLength(text: string) {
        if (text === '') {
            return 0
        }
        const tokens = await this.tokenize(text)
        return tokens.length
    }

    async countMessageTokens(message: ChatMessage) {
        return this.baseTokensPerMessage + await this.countObjectTokens(message)
    }

    private async countObjectTokens(obj: ChatMessage) {
        let numTokens = 0
        switch (obj.role) {
            case ChatRole.User:
            case ChatRole.System:
            case ChatRole.Function: {
                numTokens += await this.tokenLength(obj.content)
                numTokens += obj.name ? this.baseTokensPerName : 0
                return numTokens
            }
            case ChatRole.Assistant: {
                numTokens += await this.tokenLength(obj.content)
                numTokens += obj.name ? this.baseTokensPerName : 0
                if (obj.tool_calls) {
                    for (const toolCall of obj.tool_calls) {
                        numTokens += this.baseTokensPerName
                        numTokens += await this.tokenLength(toolCall.function.arguments)
                    }
                }
                return numTokens
            }
            case ChatRole.Tool: {
                numTokens += await this.tokenLength(obj.content)
                numTokens += obj.tool_call_id ? this.baseTokensPerName : 0
                return numTokens
            }
            default: {
                console.error('Unknown role: ', obj satisfies never)
                return numTokens
            }
        }
    }

    private async initTokenizer() {
        // The BPE rank file will be automatically downloaded and saved to node_modules/@microsoft/tiktokenizer/model if it does not exist.
        this._tokenizer.resolve(await createByModelName('gpt-4o'))
    }
}
