import * as vscode from 'vscode'
import { CancellationToken, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult, LogOutputChannel } from 'vscode'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { debugObj } from '../utils/debug.js'
import { renderElementJSON } from '@vscode/prompt-tsx'
import { CommandResultPrompt } from './toolresult.js'
import { createLanguageModelPromptTsxPart } from '../utils/prompttsxhelper.js'
import { isAllowedCommand } from './runinsandboxlib/validator.js'
import { wrapLongLines } from './runinsandboxlib/utils.js'


export interface RunInSandboxInput {
    command: string,
    explanation: string
}

export class RunInSandbox implements LanguageModelTool<RunInSandboxInput> {
    readonly tmpDir = this.setupTmpDir()

    constructor(
        private readonly extension: {
            readonly outputChannel: LogOutputChannel
        }
    ) {
        this.extension.outputChannel.info('[RunInSandbox]: RunInSandbox created')
        this.setupTmpDir()
    }

    private setupTmpDir(): string {
        const dir = path.join(os.tmpdir(), 'ableruninsandbox')
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
        }
        const resolved = fs.realpathSync(dir)
        return resolved
    }

    async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<RunInSandboxInput>) {
        const workspaceRootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath
        const isAllowed = await isAllowedCommand(options.input.command, workspaceRootPath)
        if (isAllowed) {
            return {
                invocationMessage: 'Run command by using sandbox-exec'
            }
        }
        return {
            confirmationMessages: {
                title: 'Run command by using sandbox-exec',
                message: options.input.explanation + '\n\n```sh\n' + wrapLongLines(options.input.command) + '\n```'
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

        const command = options.input.command.trim()
        if (!command) {
            this.extension.outputChannel.error('[RunInSandbox]: command is empty')
            throw new Error('[RunInSandbox]: command is empty')
        }

        const workspaceDirs = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? undefined
        if (!workspaceDirs || workspaceDirs.length === 0) {
            this.extension.outputChannel.error('[RunInSandbox]: no workspace folders')
            throw new Error('[RunInSandbox]: no workspace folders')
        }
        const denyWriteList = workspaceDirs.map(dir => path.join(dir, '.vscode'))

        // Read deny list and allowed read/write list from user settings and validate
        const userAllowedReadDirectories = this.getConfiguredAllowFileReadDirectories() ?? []
        const userAllowedRW = this.getConfiguredAllowedReadWriteDirectories()

        // Merge workspace writable dirs with user allowed read/write directories (user entries must be absolute)
        const mergedReadableWritable = [...workspaceDirs, this.tmpDir]
        if (userAllowedRW && userAllowedRW.length > 0) {
            for (const p of userAllowedRW) {
                if (typeof p === 'string' && p !== '') {
                    if (!mergedReadableWritable.includes(p)) {
                        mergedReadableWritable.push(p)
                    }
                }
            }
        }

        const { policy, params } = this.buildSeatbeltPolicyAndParams(mergedReadableWritable, userAllowedReadDirectories, denyWriteList)

        const args = ['-p', policy, ...params, '--', '/bin/bash', '-c', command]

        this.extension.outputChannel.info(`[RunInSandbox]: invoking in sandbox: ${command}`)

        const stdoutChunks: string[] = []
        const stderrChunks: string[] = []

        const minimalEnv = {
            PATH: process.env['PATH'] ?? '/usr/bin:/bin:/usr/sbin:/sbin',
            LANG: process.env['LANG'] ?? 'C.UTF-8',
            LC_ALL: process.env['LC_ALL'] ?? 'C.UTF-8',
            HOME: process.env['HOME'] ?? workspaceDirs[0],
            TMPDIR: this.tmpDir
        }
        debugObj('RunInSandbox args: ', { args, cwd: workspaceDirs[0], env: minimalEnv }, this.extension.outputChannel)
        const child = spawn(seatbeltPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
            detached: true,
            cwd: workspaceDirs[0],
            env: minimalEnv
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

        child.stdout?.setEncoding('utf8')
        child.stdout?.on('data', (buf: string) => {
            stdoutChunks.push(buf)
        })
        child.stderr?.setEncoding('utf8')
        child.stderr?.on('data', (buf: string) => {
            stderrChunks.push(buf)
        })

        let commandError: Error | undefined
        const { code: exitCode, signal } = await new Promise<{ code: number | null, signal: NodeJS.Signals | null }>((resolve) => {
            child.on('error', err => commandError = err)
            child.on('close', (code, sig) => resolve({ code, signal: sig }))
        })
        subscription.dispose()

        const stdout = stdoutChunks.join('')
        const stderr = stderrChunks.join('') ?? commandError?.message

        debugObj('RunInSandbox stdout: ', stdout, this.extension.outputChannel)
        debugObj('RunInSandbox stderr: ', stderr, this.extension.outputChannel)
        debugObj('RunInSandbox exit code: ', { code: exitCode, signal, commandError }, this.extension.outputChannel)
        const result = await renderElementJSON(CommandResultPrompt, { stdout, stderr, exitCode, signal }, options.tokenizationOptions)
        return new LanguageModelToolResult([
            createLanguageModelPromptTsxPart(result)
        ])
    }

    private buildSeatbeltPolicyAndParams(
        rwritableDirs: string[],
        userAllowedReadDirectories: string[],
        denyWriteList: string[]
    ) {
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
  (subpath "/Users")
  (subpath "/Volumes")
  (subpath "/Network")
  (subpath "/tmp")
  (subpath "/private/tmp")
  (subpath "/private/var/tmp")
  (subpath "/private/var/folders")
  (subpath "/var/tmp")
  (subpath "/var/folders")
)

(allow file-read*
  (path "/Users")
  (path "/Users/tamura")
  (path "/Users/tamura/src")
  (path "/Users/tamura/src/github")
)

(allow file-read*
  (subpath "/Users/tamura/bin")
  (subpath "/Users/tamura/.cargo")
  (subpath "/Users/tamura/.local")
  (subpath "/Users/tamura/.rustup")
  (subpath "/Users/tamura/.config")
  (path "/Users/tamura/.gitconfig")
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
        const allowedReadEntries: string[] = []
        if (userAllowedReadDirectories && userAllowedReadDirectories.length > 0) {
            for (const p of userAllowedReadDirectories) {
                if (typeof p === 'string' && p !== '') {
                    allowedReadEntries.push(p)
                }
            }
        }

        const allowRwPolicies: string[] = []
        const allowRwParams: string[] = []
        for (let i = 0; i < rwritableDirs.length; ++i) {
            allowRwPolicies.push(`(subpath (param "ALLOW_RW_ROOT_${i}"))`)
            allowRwParams.push('-D', `ALLOW_RW_ROOT_${i}=${rwritableDirs[i]}`)
        }
        let allowReadWritePolicy = ''
        if (allowRwPolicies.length > 0) {
            allowReadWritePolicy = `\n(allow file-read*\n${allowRwPolicies.join(' ')}\n)\n(allow file-write*\n${allowRwPolicies.join(' ')}\n)`
        }

        const allowReadPolicies: string[] = []
        const allowReadParams: string[] = []
        for (let i = 0; i < allowedReadEntries.length; ++i) {
            allowReadPolicies.push(`(subpath (param "ALLOW_READ_ROOT_${i}"))`)
            allowReadParams.push('-D', `ALLOW_READ_ROOT_${i}=${allowedReadEntries[i]}`)
        }
        let allowReadPolicy = ''
        if (allowReadPolicies.length > 0) {
            allowReadPolicy = `\n(allow file-read*\n${allowReadPolicies.join(' ')}\n)\n`
        }

        const denyWritePolicies: string[] = []
        const denyWriteParams: string[] = []
        for (let i = 0; i < denyWriteList.length; ++i) {
            denyWritePolicies.push(`(subpath (param "DENY_WRITE_ROOT_${i}"))`)
            denyWriteParams.push('-D', `DENY_WRITE_ROOT_${i}=${denyWriteList[i]}`)
        }
        let denyWritePolicy = ''
        if (denyWritePolicies.length > 0) {
            denyWritePolicy = `\n(deny file-write*\n${denyWritePolicies.join(' ')}\n)\n`
        }
        // Combine deny params (for denied paths) with rw params (allowed read/write roots)
        const params = [...allowRwParams, ...allowReadParams, ...denyWriteParams]
        return { policy: basePolicy + allowReadWritePolicy + allowReadPolicy + denyWritePolicy, params }
    }

    private getConfiguredAllowFileReadDirectories(): string[] | undefined {
        try {
            const cfg = vscode.workspace.getConfiguration('able')
            const raw = cfg.get<string[]>('runInSandbox.allowedFileReadDirectories')
            if (!raw || !Array.isArray(raw)) {
                return undefined
            }
            const valid: string[] = []
            for (const entry of raw) {
                if (typeof entry !== 'string') {
                    this.extension.outputChannel.warn('[RunInSandbox]: ignoring non-string entry in allowedFileReadDirectories')
                    continue
                }
                if (entry === '') {
                    this.extension.outputChannel.warn('[RunInSandbox]: ignoring empty string in allowedFileReadDirectories')
                    continue
                }
                if (!path.isAbsolute(entry)) {
                    this.extension.outputChannel.warn(`[RunInSandbox]: ignoring non-absolute path in allowedFileReadDirectories: ${entry}`)
                    continue
                }
                valid.push(entry)
            }
            return valid
        } catch {
            this.extension.outputChannel.warn('[RunInSandbox]: failed to read configured denyFileReadDirectories')
            return undefined
        }
    }

    private getConfiguredAllowedReadWriteDirectories(): string[] | undefined {
        try {
            const cfg = vscode.workspace.getConfiguration('able')
            const raw = cfg.get<string[]>('runInSandbox.allowedReadWriteDirectories')
            if (!raw || !Array.isArray(raw)) {
                return undefined
            }
            const valid: string[] = []
            for (const entry of raw) {
                if (typeof entry !== 'string') {
                    this.extension.outputChannel.warn('[RunInSandbox]: ignoring non-string entry in allowedReadWriteDirectories')
                    continue
                }
                if (entry === '') {
                    this.extension.outputChannel.warn('[RunInSandbox]: ignoring empty string in allowedReadWriteDirectories')
                    continue
                }
                if (!path.isAbsolute(entry)) {
                    this.extension.outputChannel.warn(`[RunInSandbox]: ignoring non-absolute path in allowedReadWriteDirectories: ${entry}`)
                    continue
                }
                valid.push(entry)
            }
            return valid
        } catch {
            this.extension.outputChannel.warn('[RunInSandbox]: failed to read configured allowedReadWriteDirectories')
            return undefined
        }
    }
}
