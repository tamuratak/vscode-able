import { LanguageModelChatInformation } from 'vscode'
import { OpenAICompatChatProvider } from './chatproviderlib/openaichatprovider.js'
import { openaiAuthServiceId } from '../auth/authproviders.js'

export { GeminiChatProvider } from './chatproviderlib/geminichatprovider.js'

export class OpenAIChatProvider extends OpenAICompatChatProvider {
    readonly _serviceName = 'OpenAIChatProvider'
    readonly aiModelIds: LanguageModelChatInformation[] = [
        {
            id: 'gpt-4.1-nano',
            family: 'gpt-4.1-nano',
            version: 'gpt-4.1-nano',
            maxInputTokens: 1014808,
            maxOutputTokens: 32768,
            name: 'GPT-4.1 Nano'
        }
    ]
    apiBaseUrl = undefined

    get authServiceId(): string {
        return openaiAuthServiceId
    }
}
