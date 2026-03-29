import type treeSitter from '#vscode-tree-sitter-wasm'
import path from 'node:path'
import { bashParser, collectCommands, CommandNode, getNodeText, hasNoWriteRedirection, normalizeToken, parserInitialization } from './commandparser.js'


export async function isAllowedCommand(command: string, workspaceRootPath: string | undefined): Promise<boolean> {
    const forbiddenCharacters = /[~]/
    if (forbiddenCharacters.test(command)) {
        return false
    }

    const allowPlanAppend = await isAllowedPlanAppendCommand(command, workspaceRootPath)
    if (!allowPlanAppend && !await hasNoWriteRedirection(command)) {
        return false
    }

    const commands = await collectCommands(command)
    if (commands === undefined) {
        return false
    }

    const normalizedWorkspaceRoot = workspaceRootPath ? path.normalize(workspaceRootPath) : undefined

    for (const cmd of commands) {
        for (const arg of cmd.args) {
            if (arg.includes('settings.json')) {
                return false
            }
        }

        if (isConfirmationRequired(cmd)) {
            return false
        }

        if (isAllowedSubCommand(cmd, workspaceRootPath)) {
            continue
        }

        const allowedCommands = new Set(['cat', 'cd', 'echo', 'head', 'ls', 'nl', 'rg', 'printf', 'sed', 'tail', 'grep', 'find', 'pwd', 'wc', 'true', 'sleep'])
        if (!allowedCommands.has(cmd.command)) {
            return false
        }

        if (cmd.command === 'sed') {
            const args = cmd.args
            const rangeRegex = /^\d+,\d+.(;\s*\d+,\d+.)*$|^\d+p$/
            if (args.length === 2) {
                const [first, second] = args
                if (first === '-n' && rangeRegex.test(second)) {
                    continue
                }
            } else if (args.length === 3) {
                const [first, second] = args
                if (first === '-n' && rangeRegex.test(second)) {
                    continue
                }
            }
            return false
        } else if (cmd.command === 'cd') {
            if (cmd.args.length !== 1) {
                return false
            }
            const target = path.normalize(cmd.args[0])
            if (!normalizedWorkspaceRoot || !target.startsWith(normalizedWorkspaceRoot)) {
                return false
            }
        }
    }

    return true
}

async function isAllowedPlanAppendCommand(command: string, workspaceRootPath: string | undefined): Promise<boolean> {
    if (!workspaceRootPath) {
        return false
    }

    const commands = await collectCommands(command)
    if (!commands) {
        return false
    }

    const normalizedWorkspaceRoot = path.normalize(workspaceRootPath)
    if (commands.length === 1) {
        if (commands[0].command !== 'cat' || commands[0].args.length !== 0) {
            return false
        }
    } else if (commands.length === 2) {
        if (commands[0].command !== 'cd' || commands[1].command !== 'cat') {
            return false
        }
        if (commands[0].args.length !== 1 || commands[1].args.length !== 0) {
            return false
        }
        const cdTargetOrig = commands[0].args[0]
        if (!path.isAbsolute(cdTargetOrig)) {
            return false
        }
        const cdTarget = path.normalize(cdTargetOrig)
        if (cdTarget !== normalizedWorkspaceRoot) {
            return false
        }
    } else {
        return false
    }

    const planAppendTargets = await collectPlanAppendTargets(command)
    if (planAppendTargets.length !== 1) {
        return false
    }

    const target = planAppendTargets[0]
    const allowRelativeTarget = commands.length === 2
    return resolveAllowedPlanAppendTarget(target, normalizedWorkspaceRoot, allowRelativeTarget) !== undefined
}

async function collectPlanAppendTargets(source: string): Promise<string[]> {
    await parserInitialization
    if (!bashParser) {
        return []
    }

    const tree = bashParser.parse(source)
    if (!tree) {
        return []
    }

    try {
        const targets: string[] = []
        collectPlanAppendTargetsFromNode(tree.rootNode, source, targets)
        return targets
    } finally {
        tree.delete()
    }
}

function collectPlanAppendTargetsFromNode(node: treeSitter.Node, source: string, targets: string[]): void {
    if (node.type === 'redirected_statement') {
        const target = getPlanAppendTarget(node, source)
        if (target) {
            targets.push(target)
        }
    }

    for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index)
        if (child) {
            collectPlanAppendTargetsFromNode(child, source, targets)
        }
    }
}

function getPlanAppendTarget(node: treeSitter.Node, source: string): string | undefined {
    let redirectTarget: string | undefined
    let hasHeredocRedirect = false

    for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index)
        if (!child || child.type === 'list' || child.type === 'command') {
            continue
        }

        if (child.type === 'file_redirect') {
            if (!getNodeText(child, source).trimStart().startsWith('>> ')) {
                return undefined
            }
            const targetNode = child.namedChild(0)
            if (!targetNode) {
                return undefined
            }
            redirectTarget = normalizeToken(getNodeText(targetNode, source))
            continue
        }

        if (child.type === 'heredoc_redirect') {
            hasHeredocRedirect = true
            continue
        }

        return undefined
    }

    if (!redirectTarget || !hasHeredocRedirect) {
        return undefined
    }

    return redirectTarget
}

function resolveAllowedPlanAppendTarget(target: string, workspaceRootPath: string, allowRelativeTarget: boolean): string | undefined {
    const allowedPlanAppendFiles = new Set(['plan.md', 'planexec.md', 'memo.md'])
    let normalizedTarget: string

    if (path.isAbsolute(target)) {
        normalizedTarget = path.normalize(target)
    } else {
        if (!allowRelativeTarget || target !== path.basename(target)) {
            return undefined
        }
        normalizedTarget = path.normalize(path.join(workspaceRootPath, target))
    }

    const targetBaseName = path.basename(normalizedTarget)
    if (!allowedPlanAppendFiles.has(targetBaseName)) {
        return undefined
    }

    const expectedTarget = path.join(workspaceRootPath, targetBaseName)
    if (normalizedTarget !== expectedTarget) {
        return undefined
    }

    return normalizedTarget
}

function isAllowedSubCommand(command: CommandNode, workspaceRootPath: string | undefined): boolean {
    if (command.command === 'git') {
        const validGitSubCommandsRegex = /^(status|log|diff|show|blame|rev-parse)$/
        const gitCmd = parseGitCommand(command)
        if (gitCmd && gitCmd.subCommand && validGitSubCommandsRegex.test(gitCmd.subCommand)) {
            const cpath = gitCmd.cPath
            if (cpath) {
                if (workspaceRootPath && path.isAbsolute(cpath) && isInside(cpath, workspaceRootPath)) {
                    return true
                }
            } else {
                return true
            }
        }
    }
    return false
}

export function parseGitCommand(command: CommandNode) {
    if (command.command !== 'git') {
        return
    }
    const mainArgs: string[] = []
    let cPath: string | undefined = undefined
    for(let i = 0; i < command.args.length; i++) {
        if (/^(status|log|diff|show|blame|rev-parse)$/.exec(command.args[i])) {
            return { subCommand: command.args[i], subCommandArgs: command.args.slice(i + 1), mainArgs, cPath }
        } else if (command.args[i] === '-C') {
            cPath = command.args[i + 1]
            i += 1
        } else if (command.args[i] === '--no-pager') {
            mainArgs.push(command.args[i])
        } else {
            return
        }
    }
    return
}


//
// https://github.com/microsoft/vscode/blob/698d618f29e978c2ca7f45570d148e6eb9aa2a66/src/vs/workbench/contrib/terminalContrib/chatAgentTools/common/terminalChatAgentToolsConfiguration.ts#L240
//
function isConfirmationRequired(command: CommandNode): boolean {
    const needConfirmationCommands = new Set([
        'rm', 'rmdir', 'mv', 'cp', 'chmod', 'chown',
        'dd', 'mkfs', 'mount', 'umount', 'ln', 'touch', 'truncate',
        'kill', 'pkill', 'ps', 'top', 'htop',
        'xargs', 'eval', 'nohup', 'sudo', 'env', 'export', 'nice', 'renice', 'watch', 'time', 'timeout',
        'shutdown', 'reboot', 'sysctl',
        'tee'
    ])

    if (needConfirmationCommands.has(command.command)) {
        return true
    }

    const needConfirmationPatterns: [string, RegExp][] = [
        ['date', /^(-s|--set)\b/],
        ['rg', /^--(pre|hostname-bin)\b/],
        ['find', /^-(delete|exec|execdir|fprint|fprintf|fls|ok|okdir)\b/],
        ['sed', /^(-[a-zA-Z]*(e|i|I|f)[a-zA-Z]*|--expression|--file|--in-place)\b/],
        ['sort', /^-(o|S)\b/],
        ['tree', /^-o\b/],
    ]
    for (const [cmd, pattern] of needConfirmationPatterns) {
        if (partialMatchCommand([cmd, pattern], command)) {
            return true
        }
    }

    if (partialMatchCommand(['column', /^-c\b/], command)) {
        if (command.args.find((arg) => /[0-9]{4,}/.test(arg))) {
            return true
        }
    }

    return false
}

/**
 * Returns true if the input command starts with the given pattern.
 */
export function commandStartsWith(pattern: (string | RegExp)[], command: CommandNode): boolean {
    if (pattern[0] !== command.command) {
        return false
    }
    for (let i = 1; i < pattern.length; i++) {
        const p = pattern[i]
        const inp = command.args[i - 1]
        if (typeof p === 'string') {
            if (p !== inp) {
                return false
            }
        } else {
            if (!p.test(inp)) {
                return false
            }
        }
    }
    return true
}

/**
 * Returns true if one of the arguments matches some pattern.
 */
function partialMatchCommand(pattern: (string | RegExp)[], command: CommandNode): boolean {
    if (pattern[0] !== command.command) {
        return false
    }
    const argPatterns = pattern.slice(1)
    return !!argPatterns.find((pat) => {
        for (const arg of command.args) {
            if (typeof pat === 'string') {
                if (pat === arg) {
                    return true
                }
            } else {
                if (pat.test(arg)) {
                    return true
                }
            }
        }
        return false
    })
}

function isInside(childPath: string, parentPath: string): boolean {
    if (!path.isAbsolute(childPath) || !path.isAbsolute(parentPath)) {
        return false
    }
    const absoluteChild = path.resolve(childPath)
    const absoluteParent = path.resolve(parentPath)
    if (absoluteChild === absoluteParent) {
        return true
    }
    const relative = path.relative(absoluteParent, absoluteChild)
    return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}
