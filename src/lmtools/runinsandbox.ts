import * as vscode from 'vscode'
import { CancellationToken, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult, LogOutputChannel, PreparedToolInvocation } from 'vscode'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { debugObj } from '../utils/debug.js'
import { renderElementJSON } from '@vscode/prompt-tsx'
import { CommandResultPrompt } from './toolresult.js'


export interface RunInSandboxInput {
    command: string,
    explanation: string
}

export class RunInSandbox implements LanguageModelTool<RunInSandboxInput> {
    constructor(
        private readonly extension: {
            readonly outputChannel: LogOutputChannel
        }
    ) {
        this.extension.outputChannel.info('[RunInSandbox]: RunInSandbox created')
    }

    prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<RunInSandboxInput>): PreparedToolInvocation {
        return {
            confirmationMessages: {
                title: 'Run command by using sandbox-exec',
                message: options.input.explanation + '\n\n```sh\n' + options.input.command + '\n```'
            }
        }
    }

    async invoke(options: LanguageModelToolInvocationOptions<RunInSandboxInput>, token: CancellationToken) {
        // Validate environment
        if (process.platform !== 'darwin') {
            this.extension.outputChannel.error('[RunInSandbox]: macOS only. sandbox-exec is unavailable on this platform')
            throw new Error('[RunInSandbox]: This tool requires macOS (sandbox-exec)')
        }

        const seatbeltPath = '/usr/bin/sandbox-exec'
        if (!fs.existsSync(seatbeltPath)) {
            this.extension.outputChannel.error('[RunInSandbox]: /usr/bin/sandbox-exec not found')
            throw new Error('[RunInSandbox]: sandbox-exec not found')
        }

        const command = options.input.command?.trim()
        if (!command) {
            this.extension.outputChannel.error('[RunInSandbox]: command is empty')
            throw new Error('[RunInSandbox]: command is empty')
        }

        // Decide writable directories: none by default, but validate if provided via explanation string in future
        const rwritableDirs = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? undefined

        if (!rwritableDirs) {
            this.extension.outputChannel.error('[RunInSandbox]: no workspace folders')
            throw new Error('[RunInSandbox]: no workspace folders')
        }

        const { policy, params } = this.buildSeatbeltPolicyAndParams(rwritableDirs)

        const args = ['-p', policy, ...params, '--', '/bin/zsh', '-lc', command]

        this.extension.outputChannel.info(`[RunInSandbox]: invoking in sandbox: ${command}`)

        const stdoutChunks: string[] = []
        const stderrChunks: string[] = []

        debugObj('RunInSandbox args: ', { args, cwd: rwritableDirs[0] }, this.extension.outputChannel)
        const child = spawn(seatbeltPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
            detached: true,
            cwd: rwritableDirs[0]
        })

        // Wire cancellation to kill the whole process group
        const killGroup = () => {
            if (child.pid) {
                try {
                    process.kill(-child.pid, 'SIGKILL')
                } catch {
                    try { child.kill('SIGKILL') } catch { }
                }
            }
        }
        const subscription = token.onCancellationRequested(() => {
            this.extension.outputChannel.warn('[RunInSandbox]: cancellation requested, killing sandboxed process group')
            killGroup()
        })

        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (buf: string) => {
            stdoutChunks.push(buf)
        })
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (buf: string) => {
            stderrChunks.push(buf)
        })

        let commandError: Error | undefined
        const { code: exitCode, signal } = await new Promise<{ code: number | null, signal: NodeJS.Signals | null }>((resolve) => {
            child.on('error', err => commandError = err)
            child.on('close', (code, sig) => resolve({ code, signal: sig }))
        })
        subscription.dispose()

        const stdout = stdoutChunks.join('')
        const stderr = stderrChunks.join('')

        debugObj('RunInSandbox stdout: ', stdout, this.extension.outputChannel)
        debugObj('RunInSandbox stderr: ', stderr, this.extension.outputChannel)
        debugObj('RunInSandbox exit code: ', { code: exitCode, signal, commandError }, this.extension.outputChannel)
        const result = await renderElementJSON(CommandResultPrompt, { stdout, stderr, exitCode, signal }, options.tokenizationOptions)
        return new LanguageModelToolResult([
            new vscode.LanguageModelPromptTsxPart(result)
        ])
    }

    private buildSeatbeltPolicyAndParams(rwritableDirs: string[]) {
        for (const dir of rwritableDirs) {
            if (!path.isAbsolute(dir) || dir === '') {
                throw new Error(`[RunInSandbox]: -w DIR must be an absolute path. Got: ${dir}`)
            }
        }
        const basePolicy = `
(version 1)

; inspired by Chrome's sandbox policy:
; https://source.chromium.org/chromium/chromium/src/+/main:sandbox/policy/mac/common.sb;l=273-319;drc=7b3962fe2e5fc9e2ee58000dc8fbf3429d84d3bd
; https://github.com/openai/codex/blob/81bb1c9e264095708a01f6326bf8d527a6b2d47b/codex-cli/src/utils/agent/sandbox/macos-seatbelt.ts#L80

; start with closed-by-default
(deny default)

; allow read-only file operations
(allow file-read*)
(deny file-read*
  (subpath "/Users/")
)
(allow file-read*
  (subpath "/Users/tamura/.npm/")
  (subpath "/Users/tamura/.yarn/")
  (subpath "/Users/tamura/.cargo/")
  (subpath "/Users/tamura/.rustup/")
  (subpath "/Users/tamura/.cache/")
  (subpath "/Users/tamura/Library/org.swift.swiftpm/")
  (subpath "/Users/tamura/Library/Caches/org.swift.swiftpm/")
)
(allow file-write*
  (subpath "/private/var/folders")
  (subpath "/Users/tamura/Library/org.swift.swiftpm/")
  (subpath "/Users/tamura/Library/Caches/org.swift.swiftpm/")
)

; child processes inherit the policy of their parent
(allow process-exec)
(allow process-fork)
(allow signal (target self))
(allow file-write-data (require-all (path "/dev/null") (vnode-type CHARACTER-DEVICE)))
(allow sysctl-read
  (sysctl-name "hw.activecpu")
  (sysctl-name "hw.busfrequency_compat")
  (sysctl-name "hw.byteorder")
  (sysctl-name "hw.cacheconfig")
  (sysctl-name "hw.cachelinesize_compat")
  (sysctl-name "hw.cpufamily")
  (sysctl-name "hw.cpufrequency_compat")
  (sysctl-name "hw.cputype")
  (sysctl-name "hw.l1dcachesize_compat")
  (sysctl-name "hw.l1icachesize_compat")
  (sysctl-name "hw.l2cachesize_compat")
  (sysctl-name "hw.l3cachesize_compat")
  (sysctl-name "hw.logicalcpu_max")
  (sysctl-name "hw.machine")
  (sysctl-name "hw.ncpu")
  (sysctl-name "hw.nperflevels")
  (sysctl-name "hw.optional.arm.FEAT_BF16")
  (sysctl-name "hw.optional.arm.FEAT_DotProd")
  (sysctl-name "hw.optional.arm.FEAT_FCMA")
  (sysctl-name "hw.optional.arm.FEAT_FHM")
  (sysctl-name "hw.optional.arm.FEAT_FP16")
  (sysctl-name "hw.optional.arm.FEAT_I8MM")
  (sysctl-name "hw.optional.arm.FEAT_JSCVT")
  (sysctl-name "hw.optional.arm.FEAT_LSE")
  (sysctl-name "hw.optional.arm.FEAT_RDM")
  (sysctl-name "hw.optional.arm.FEAT_SHA512")
  (sysctl-name "hw.optional.armv8_2_sha512")
  (sysctl-name "hw.memsize")
  (sysctl-name "hw.pagesize")
  (sysctl-name "hw.packages")
  (sysctl-name "hw.pagesize_compat")
  (sysctl-name "hw.physicalcpu_max")
  (sysctl-name "hw.tbfrequency_compat")
  (sysctl-name "hw.vectorunit")
  (sysctl-name "kern.hostname")
  (sysctl-name "kern.maxfilesperproc")
  (sysctl-name "kern.osproductversion")
  (sysctl-name "kern.osrelease")
  (sysctl-name "kern.ostype")
  (sysctl-name "kern.osvariant_status")
  (sysctl-name "kern.osversion")
  (sysctl-name "kern.secure_kernel")
  (sysctl-name "kern.usrstack64")
  (sysctl-name "kern.version")
  (sysctl-name "sysctl.proc_cputype")
  (sysctl-name-prefix "hw.perflevel")
)
`

        const policies: string[] = []
        const params: string[] = []
        for (let i = 0; i < rwritableDirs.length; ++i) {
            policies.push(`(subpath (param "RWRITABLE_ROOT_${i}"))`)
            params.push(`-DRWRITABLE_ROOT_${i}=${rwritableDirs[i]}`)
        }
        let readWritePolicy = ''
        if (policies.length > 0) {
            readWritePolicy = `\n(allow file-read*\n${policies.join(' ')}\n)\n(allow file-write*\n${policies.join(' ')}\n)`
        }
        return { policy: basePolicy + readWritePolicy, params }
    }
}
