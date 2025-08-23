import { CancellationToken, LanguageModelTool, LanguageModelToolInvocationOptions, LogOutputChannel } from 'vscode'
import * as vscode from 'vscode'

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
