import { ModelInformation, OpenAICompatChatProvider } from './chatproviderlib/openaicompatchatprovider.js'
import { groqAuthServiceId, openaiAuthServiceId } from '../auth/authproviders.js'

export { GeminiChatProvider } from './chatproviderlib/geminichatprovider.js'

export class OpenAIChatProvider extends OpenAICompatChatProvider {
    readonly serviceName = 'OpenAIChatProvider'
    readonly categoryLabel = 'OpenAI (with Able)'
    readonly apiBaseUrl = undefined
    readonly streamSupported = true

    get aiModelIds(): ModelInformation[] {
        return [
            {
                id: 'gpt-5',
                family: 'gpt-5',
                version: 'gpt-5',
                maxInputTokens: 1014808,
                maxOutputTokens: 32768,
                name: 'GPT-5',
                tooltip: 'GPT-5',
                capabilities: {
                    toolCalling: true,
                    imageInput: true
                }
            },
            {
                id: 'gpt-5-mini',
                family: 'gpt-5-mini',
                version: 'gpt-5-mini',
                maxInputTokens: 1014808,
                maxOutputTokens: 32768,
                name: 'GPT-5 Mini',
                tooltip: 'GPT-5 Mini',
                capabilities: {
                    toolCalling: true,
                    imageInput: true
                },
            },
            {
                id: 'gpt-5-mini-high',
                family: 'gpt-5-mini',
                version: 'gpt-5-mini',
                maxInputTokens: 1014808,
                maxOutputTokens: 32768,
                name: 'GPT-5 Mini (high)',
                tooltip: 'GPT-5 Mini (high)',
                capabilities: {
                    toolCalling: true,
                    imageInput: true
                },
                options: {
                    reasoningEffort: 'high'
                }
            },
            {
                id: 'gpt-4.1',
                family: 'gpt-4.1',
                version: 'gpt-4.1',
                maxInputTokens: 1014808,
                maxOutputTokens: 32768,
                name: 'GPT-4.1',
                tooltip: 'GPT-4.1',
                capabilities: {
                    toolCalling: true,
                    imageInput: true
                }
            },
            {
                id: 'gpt-4.1-mini',
                family: 'gpt-4.1-mini',
                version: 'gpt-4.1-mini',
                maxInputTokens: 1014808,
                maxOutputTokens: 32768,
                name: 'GPT-4.1 Mini',
                tooltip: 'GPT-4.1 Mini',
                capabilities: {
                    toolCalling: true,
                    imageInput: true
                }
            },
            {
                id: 'gpt-4o-mini',
                family: 'gpt-4o-mini',
                version: 'gpt-4o-mini',
                maxInputTokens: 128000,
                maxOutputTokens: 16384,
                name: 'GPT-4o Mini',
                tooltip: 'GPT-4o Mini',
                capabilities: {
                    toolCalling: true,
                    imageInput: true
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
    readonly streamSupported = true


    get aiModelIds(): ModelInformation[] {
        return [
            {
                id: 'openai/gpt-oss-120b',
                family: 'openai/gpt-oss-120b',
                version: 'openai/gpt-oss-120b',
                maxInputTokens: 131072,
                maxOutputTokens: 32766,
                name: 'GPT OSS 120b',
                tooltip: 'GPT OSS 120b',
                capabilities: {
                    toolCalling: true
                },
                options: {
                    reasoningEffort: 'medium'
                }
            },
            {
                id: 'openai/gpt-oss-120b-high',
                family: 'openai/gpt-oss-120b',
                version: 'openai/gpt-oss-120b',
                maxInputTokens: 131072,
                maxOutputTokens: 32766,
                name: 'GPT OSS 120b (high)',
                tooltip: 'GPT OSS 120b (high)',
                capabilities: {
                    toolCalling: true
                },
                options: {
                    reasoningEffort: 'high'
                }
            }
        ]
    }

    get authServiceId(): string {
        return groqAuthServiceId
    }

}
