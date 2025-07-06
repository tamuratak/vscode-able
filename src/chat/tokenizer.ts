import {
    createByModelName,
    TikTokenizer,
} from '@microsoft/tiktokenizer'
import { type ITokenizer, Raw, OpenAI, OutputMode } from '@vscode/prompt-tsx'
import { ExternalPromise } from '../utils/externalpromise.js'


export class Gpt4oTokenizer implements ITokenizer<OutputMode.OpenAI> {
    readonly mode = OutputMode.OpenAI
    private readonly _tokenizer = new ExternalPromise<TikTokenizer>()
    private readonly baseTokensPerMessage = OpenAI.BaseTokensPerMessage
    private readonly baseTokensPerName = OpenAI.BaseTokensPerName

    constructor() {
        void this.initTokenizer()
    }

    private async tokenize(text: string) {
        const tokenizer = await this._tokenizer.promise
        return tokenizer.encode(text)
    }

    async tokenLength(part: Raw.ChatCompletionContentPart) {
        if (part.type === Raw.ChatCompletionContentPartKind.Text) {
            const tokens = await this.tokenize(part.text)
            return tokens.length
        } else {
            return 0
        }
    }

    private async tokenLength2(part: OpenAI.ChatCompletionContentPart | string) {
        if (typeof part === 'string') {
            return this.getLengthAsToken(part)
        } if (part.type === 'text') {
            const tokens = await this.tokenize(part.text)
            return tokens.length
        } else {
            return 0
        }
    }

    private async getLengthAsToken(text: string) {
        const tokens = await this.tokenize(text)
        return tokens.length
    }

    async countMessageTokens(message: OpenAI.ChatMessage) {
        return this.baseTokensPerMessage + await this.countObjectTokens(message)
    }

    private async countObjectTokens(obj: OpenAI.ChatMessage) {
        let numTokens = 0
        switch (obj.role) {
            case OpenAI.ChatRole.User:
            case OpenAI.ChatRole.System:
            case OpenAI.ChatRole.Function: {
                for (const part of obj.content) {
                    numTokens += await this.tokenLength2(part)
                }
                numTokens += obj.name ? this.baseTokensPerName : 0
                return numTokens
            }
            case OpenAI.ChatRole.Assistant: {
                for (const part of obj.content) {
                    numTokens += await this.getLengthAsToken(part)
                }
                numTokens += obj.name ? this.baseTokensPerName : 0
                if (obj.tool_calls) {
                    for (const toolCall of obj.tool_calls) {
                        numTokens += this.baseTokensPerName
                        numTokens += await this.getLengthAsToken(toolCall.function.arguments)
                    }
                }
                return numTokens
            }
            case OpenAI.ChatRole.Tool: {
                for (const part of obj.content) {
                    numTokens += await this.tokenLength2(part)
                }
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
