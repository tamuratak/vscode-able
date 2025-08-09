import { LanguageModelChatInformation } from 'vscode'
import { OpenAICompatChatProvider } from './chatproviderlib/openaicompatchatprovider.js'
import { cerebrasAuthServiceId, groqAuthServiceId, openaiAuthServiceId } from '../auth/authproviders.js'

export { GeminiChatProvider } from './chatproviderlib/geminichatprovider.js'

export class OpenAIChatProvider extends OpenAICompatChatProvider {
    readonly serviceName = 'OpenAIChatProvider'
    readonly categoryLabel = 'OpenAI (with Able)'
    readonly apiBaseUrl = undefined

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
            },
            {
                id: 'gpt-4o-mini',
                family: 'gpt-4o-mini',
                version: 'gpt-4o-mini',
                maxInputTokens: 128000,
                maxOutputTokens: 16384,
                name: 'GPT-4o Mini',
                capabilities: {
                    toolCalling: true
                }
            }
        ]
    }

    get authServiceId(): string {
        return openaiAuthServiceId
    }

}

export class GroqChatProvider extends OpenAICompatChatProvider {
    readonly serviceName = 'GroqChatProvider'
    readonly categoryLabel = 'Groq (with Able)'
    readonly apiBaseUrl = 'https://api.groq.com/openai/v1'


    get aiModelIds(): LanguageModelChatInformation[] {
        return [
            {
                id: 'openai/gpt-oss-120b',
                family: 'openai/gpt-oss-120b',
                version: 'openai/gpt-oss-120b',
                maxInputTokens: 131072,
                maxOutputTokens: 32766,
                name: 'GPT OSS 120b',
                capabilities: {
                    toolCalling: true
                }
            }
        ]
    }

    get authServiceId(): string {
        return groqAuthServiceId
    }

}

export class CerebrasChatProvider extends OpenAICompatChatProvider {
    readonly serviceName = 'CerebrasChatProvider'
    readonly categoryLabel = 'Cerebras (with Able)'
    readonly apiBaseUrl = 'https://api.cerebras.ai/v1'

    get aiModelIds(): LanguageModelChatInformation[] {
        return [
            {
                id: 'gpt-oss-120b',
                family: 'gpt-oss-120b',
                version: 'gpt-oss-120b',
                maxInputTokens: 64000,
                maxOutputTokens: 32766,
                name: 'GPT OSS 120b',
                capabilities: {
                    toolCalling: false
                }
            },
            {
                id: 'qwen-3-32b',
                family: 'qwen-3-32b',
                version: 'qwen-3-32b',
                maxInputTokens: 65536,
                maxOutputTokens: 32766,
                name: 'Qwen 3 32b',
                capabilities: {
                    toolCalling: true
                }
            }
        ]
    }

    get authServiceId(): string {
        return cerebrasAuthServiceId
    }

}
