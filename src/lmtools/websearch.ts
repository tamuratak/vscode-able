import { CancellationToken, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult, LogOutputChannel } from 'vscode'
import { GoogleGenAI } from '@google/genai'
import * as vscode from 'vscode'
import { GeminiAuthServiceId } from '../auth/authproviders.js'
import { resolveRedirectUri } from './websearchlib/utils.js'
import { debugObj } from '../utils/debug.js'
import { renderElementJSON } from '@vscode/prompt-tsx'
import { WebSearchResultPrompt } from './toolresult.js'

export interface WebSearchInput {
    query: string
}

export class WebSearchTool implements LanguageModelTool<WebSearchInput> {
    constructor(
        private readonly extension: {
            readonly outputChannel: LogOutputChannel
        }
    ) {
        this.extension.outputChannel.info('[WebSearchTool]: WebSearchTool created')
    }

    async invoke(options: LanguageModelToolInvocationOptions<WebSearchInput>, _token: CancellationToken) {
        const session = await vscode.authentication.getSession(GeminiAuthServiceId, [], { silent: true })
        if (!session) {
            this.extension.outputChannel.error('[WebSearchTool]: Gemini API key not found. Please login to Gemini.')
            throw new Error('[WebSearchTool]: Failed to get Gemini API key')
        }
        const apiKey = session.accessToken
        const ai = new GoogleGenAI({ apiKey })
        const config = {
            tools: [{ googleSearch: {} }],
        }
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: options.input.query,
            config,
        })
        debugObj('WebSearch response: ', response, this.extension.outputChannel)
        const candidate = response.candidates?.[0]
        if (!candidate) {
            this.extension.outputChannel.error('[WebSearchTool]: No search result found')
            throw new Error('[WebSearchTool]: No search result found')
        }
        const content = candidate?.content
        const text = content?.parts?.[0].text ?? ''
        const links = candidate?.groundingMetadata?.groundingChunks
            ?.map((chunk) => chunk.retrievedContext?.uri ?? chunk.web?.uri)
            .filter((uri) => typeof uri === 'string')
        let resolvedLinks: string[] = []
        if (links && links.length > 0) {
            const redirectPromises = links.map(async (link) => {
                try {
                    const redirected = await resolveRedirectUri(link)
                    return redirected ?? link
                } catch {
                    return link
                }
            })
            resolvedLinks = await Promise.all(redirectPromises)
        }
        const result = await renderElementJSON(WebSearchResultPrompt, { text, links: resolvedLinks }, options.tokenizationOptions)
        return new LanguageModelToolResult([
            new vscode.LanguageModelPromptTsxPart(result)
        ])
    }

}
