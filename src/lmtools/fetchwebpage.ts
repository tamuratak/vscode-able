import { CancellationToken, LanguageModelTool, LanguageModelToolInvocationOptions, LogOutputChannel, LanguageModelToolResult2, LanguageModelTextPart } from 'vscode'
import * as vscode from 'vscode'
import { getFullAXTree } from './fetchwebpagelib/axtree.js'
import { AXNode, convertAXTreeToMarkdown } from './fetchwebpagelib/cdpaccessibilitydomain.js'
import { chromium } from 'playwright'

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
    private readonly browserPromise = chromium.launch({ headless: true })
    constructor(
        private readonly extension: {
            readonly outputChannel: LogOutputChannel
        }
    ) {
        this.extension.outputChannel.info('[FetchWebPageTool]: FetchWebPageTool created')
    }

    async invoke(options: LanguageModelToolInvocationOptions<FetchWebPageInput>) {
        const browser = await this.browserPromise
        const result = await getFullAXTree(browser, options.input.url)
        const md = convertAXTreeToMarkdown(vscode.Uri.parse(options.input.url, true), result.nodes as unknown as AXNode[])
        return new LanguageModelToolResult2([new LanguageModelTextPart(md)])
    }

}
