import * as vscode from 'vscode'
import { spawn } from 'node:child_process'


export function executeGeminiCliCommand(
    prompt: string,
    model: string,
    systemPromptPath: string,
    token: vscode.CancellationToken
): Promise<string> {
    const cmd = 'gemini'
    const args: string[] = ['--model', model]

    return new Promise<string>((resolve) => {
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
            resolve('Error: ' + err.message)
        })

        child.on('close', (code) => {
            if (code !== 0) {
                const msg = stderr || ('gemini exited with code ' + code)
                resolve(msg)
            } else {
                resolve(stdout)
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
