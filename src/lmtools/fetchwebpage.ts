import { CancellationToken, LanguageModelTool, LanguageModelToolInvocationOptions, LogOutputChannel, LanguageModelToolResult2, LanguageModelTextPart } from 'vscode'
import * as vscode from 'vscode'
import { getFullAXTree } from '../fetchwebpage/axtree.js'
import { AXNode, convertAXTreeToMarkdown } from '../fetchwebpage/cdpaccessibilitydomain.js'
import { browserPromise } from '../fetchwebpage/browser.js'

export interface FetchWebPageInput {
    url: string
}

export class FetchWebPageTool implements LanguageModelTool<FetchWebPageInput> {
    constructor(
        private readonly extension: {
            readonly outputChannel: LogOutputChannel
        }
    ) {
        this.extension.outputChannel.info('[FetchWebPageTool]: FetchWebPageTool created')
    }

    async invoke(options: LanguageModelToolInvocationOptions<FetchWebPageInput>, token: CancellationToken) {
        const result = await vscode.lm.invokeTool(
            'vscode_fetchWebPage_internal',
            {
                ...options,
                input: {
                    urls: [options.input.url]
                },
            },
            token
        )
        return result
    }

}

export class FetchWebPageToolAutoApprove implements LanguageModelTool<FetchWebPageInput> {
    constructor(
        private readonly extension: {
            readonly outputChannel: LogOutputChannel
        }
    ) {
        this.extension.outputChannel.info('[FetchWebPageTool]: FetchWebPageTool created')
    }

    async invoke(options: LanguageModelToolInvocationOptions<FetchWebPageInput>) {
        const browser = await browserPromise
        const uri = vscode.Uri.parse(options.input.url, true)
        if (uri.scheme === 'file') {
            throw new Error('file: URLs are not supported for security reasons')
        }
        const result = await getFullAXTree(browser, options.input.url)
        const md = convertAXTreeToMarkdown(uri, result.nodes as unknown as AXNode[])
        return new LanguageModelToolResult2([new LanguageModelTextPart(md)])
    }

}
