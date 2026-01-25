/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode'
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'

interface StreamJsonBase {
    type: string
    timestamp: string
}

interface Init extends StreamJsonBase {
    type: 'init'
    model: string
    session_id: string
}

interface Result extends StreamJsonBase {
    type: 'result'
    status: string
    stats: {
        total_tokens: number,
        input_tokens: number,
        output_tokens: number,
        cached: number,
        input: number,
        duration_ms: number,
        tool_calls: number
    }
}

interface UserMessage extends StreamJsonBase {
    type: 'message'
    role: 'user'
    content: string
}

interface AssistantMessage extends StreamJsonBase {
    type: 'message'
    role: 'assistant'
    content: string
}

type StreamJson = Init | Result | UserMessage | AssistantMessage

export interface GeminiCliResult {
    error?: string | undefined,
    usage?: Result | undefined

}

export function executeGeminiCliCommand(
    prompt: string,
    model: string,
    systemPromptPath: string,
    token: vscode.CancellationToken,
    progress: (line: string) => void,
    errorProgress: (line: string) => void
): Promise<GeminiCliResult> {
    const cmd = 'gemini'
    const args: string[] = ['--output-format', 'stream-json', '--model', model]

    return new Promise<GeminiCliResult>((resolve) => {
        const child = spawn(cmd, args,
            {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, 'GEMINI_SYSTEM_MD': systemPromptPath }
            }
        )
        let usage: Result | undefined = undefined

        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')

        const lineReader = createInterface({ input: child.stdout })

            lineReader.on('line', (line: string) => {
                try {
                    const json = JSON.parse(line) as StreamJson
                    if (json.type === 'message' && json.role === 'assistant') {
                        progress(json.content)
                    } else if (json.type === 'result') {
                        usage = json
                    }
                } catch {
                    // ignore JSON parse errors
                }
            })


        // collect stderr
        child.stderr.on('data', (chunk: string) => {
            errorProgress(chunk)
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
            progress('Error: ' + err.message)
            resolve({ error: err.message, usage })
        })

        child.on('close', (code) => {
            lineReader.close()
            if (code !== 0) {
                const error = 'gemini exited with code ' + code
                progress(error)
                resolve({ error, usage })
            } else {
                resolve({ usage })
            }
        })

        // write input to stdin and close
        try {
            child.stdin.write(prompt)
            child.stdin.end()
        } catch {
            // ignore write errors
        }
    })
}
