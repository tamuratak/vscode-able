import * as vscode from 'vscode'
import { debugObj } from '../utils/debug.js'
import { spawn } from 'node:child_process'


export class GeminiChatHandleManager {

    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) {
        this.extension.outputChannel.info('GeminiChatHandleManager initialized')
    }

    getHandler(): vscode.ChatRequestHandler {
        return async (
            request: vscode.ChatRequest,
            _context: vscode.ChatContext,
            stream: vscode.ChatResponseStream,
            token: vscode.CancellationToken
        ): Promise<vscode.ChatResult | undefined> => {
            return this.responseForCommand(token, request, stream)
        }
    }

    private async responseForCommand(
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
    ): Promise<vscode.ChatResult | undefined> {
        debugObj('[Gemini CLI (with Able)] request.references: ', request.references, this.extension.outputChannel)
        const cmd = 'gemini'
        const model = request.command === 'pro' ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview'
        const args: string[] = ['--model', model]
        const systemPromptPath = '/Users/tamura/src/github/vscode-able/lib/geminicli/system.md'

        await new Promise<void>((resolve) => {
            const child = spawn(cmd, args,
                {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env, 'GEMINI_SYSTEM_MD': systemPromptPath }
                }
            )
            let stdout = ''
            let stderr = ''

            child.stdout.setEncoding('utf8')
            child.stderr.setEncoding('utf8')

            // collect stdout
            child.stdout.on('data', (chunk: string) => {
                stdout += chunk
            })

            // collect stderr
            child.stderr.on('data', (chunk: string) => {
                stderr += chunk
            })

            // on cancellation kill child
            token.onCancellationRequested(() => {
                try {
                    child.kill()
                } catch {
                    // ignore
                }
            })

            child.on('error', (err: Error) => {
                this.extension.outputChannel.error('gemini spawn error: ' + err.message)
                stream.markdown('Error: ' + err.message)
                resolve()
            })

            child.on('close', (code) => {
                if (code !== 0) {
                    this.extension.outputChannel.error('gemini exited ' + code + ': ' + stderr)
                    const msg = stderr || ('gemini exited with code ' + code)
                    stream.markdown(msg)
                } else {
                    stream.markdown(stdout)
                }
                resolve()
            })

            // write input to stdin and close
            try {
                child.stdin.write(request.prompt)
                child.stdin.end()
            } catch {
                // ignore write errors
            }
        })

        return
    }


}
