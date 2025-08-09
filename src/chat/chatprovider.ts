import { LanguageModelChatInformation } from 'vscode'
import { OpenAICompatChatProvider } from './chatproviderlib/openaicompatchatprovider.js'
import { openaiAuthServiceId } from '../auth/authproviders.js'

export { GeminiChatProvider } from './chatproviderlib/geminichatprovider.js'

export class OpenAIChatProvider extends OpenAICompatChatProvider {
    readonly _serviceName = 'OpenAIChatProvider'
    readonly categoryLabel = 'OpenAI (with Able)'

    get aiModelIds(): LanguageModelChatInformation[] {
        return [
            {
                id: 'gpt-5',
                family: 'gpt-5',
                version: 'gpt-5',
                maxInputTokens: 1014808,
                maxOutputTokens: 32768,
                name: 'GPT-5',
                capabilities: {
                    toolCalling: true
                }
            },
            {
                id: 'gpt-5-mini',
                family: 'gpt-5-mini',
                version: 'gpt-5-mini',
                maxInputTokens: 1014808,
                maxOutputTokens: 32768,
                name: 'GPT-5 Mini',
                capabilities: {
                    toolCalling: true
                }
            },
            {
                id: 'gpt-4.1',
                family: 'gpt-4.1',
                version: 'gpt-4.1',
                maxInputTokens: 1014808,
                maxOutputTokens: 32768,
                name: 'GPT-4.1',
                capabilities: {
                    toolCalling: true
                }
            },
            {
                id: 'gpt-4.1-mini',
                family: 'gpt-4.1-mini',
                version: 'gpt-4.1-mini',
                maxInputTokens: 1014808,
                maxOutputTokens: 32768,
                name: 'GPT-4.1 Mini',
                capabilities: {
                    toolCalling: true
                }
            }
        ]
    }

    get apiBaseUrl(): string | undefined {
        return undefined
    }

    get authServiceId(): string {
        return openaiAuthServiceId
    }

}
