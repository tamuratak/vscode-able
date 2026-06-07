import type treeSitter from '#vscode-tree-sitter-wasm'
import path from 'node:path'
import { bashParser, collectCommands, getNodeText, normalizeToken, parserInitialization } from '../commandparser.js'

export async function isAllowedPlanAppendCommand(command: string, workspaceRootPath: string | undefined): Promise<boolean> {
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

export async function collectPlanAppendTargets(source: string): Promise<string[]> {
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

export function getPlanAppendTarget(node: treeSitter.Node, source: string): string | undefined {
    let redirectTarget: string | undefined
    let hasHeredocRedirect = false

    for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index)
        if (!child || child.type === 'list' || child.type === 'command') {
            continue
        }

        if (child.type === 'file_redirect') {
            if (!getNodeText(child, source).trimStart().startsWith('>>')) {
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

export function resolveAllowedPlanAppendTarget(target: string, workspaceRootPath: string, allowRelativeTarget: boolean): string | undefined {
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
