import { CancellationToken, LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult, LogOutputChannel } from 'vscode'
import { GoogleGenAI } from '@google/genai'
import * as vscode from 'vscode'
import { GeminiAuthServiceId } from '../auth/authproviders.js'
import { resolveRedirectUri } from './websearchlib/utils.js'
import { debugObj } from '../utils/debug.js'

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
        let text = ''
        if (content?.parts && content.parts.length > 0 && typeof content.parts[0].text === 'string') {
            text = content.parts[0].text
        }
        let links: string[] = []
        if (candidate?.groundingMetadata && Array.isArray(candidate.groundingMetadata.groundingChunks)) {
            links = candidate.groundingMetadata.groundingChunks
                .map((chunk) => chunk.retrievedContext?.uri ?? chunk.web?.uri)
                .filter((uri) => typeof uri === 'string')
        }
        let markdown = text
        if (links.length > 0) {
            markdown += '\n\n---\n'
            // Convert all links to their redirect destinations
            const redirectPromises = links.map(async (link) => {
                const redirected = await resolveRedirectUri(link)
                return redirected ?? link
            })
            const resolvedLinks = await Promise.all(redirectPromises)
            for (const link of resolvedLinks) {
                markdown += `- [source](${link})\n`
            }
        }
        return new LanguageModelToolResult([
            new LanguageModelTextPart(markdown)
        ])
    }

}
