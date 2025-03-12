import * as vscode from 'vscode'
import { TreeNode } from '../../utils/asciitree.js'
import type { GitExtension } from '../../../types/vscodegit/git.js'


async function checkIgnore(uris: vscode.Uri[]): Promise<Set<string>> {
    if (uris.length === 0) {
        return new Set();
    }
    const vscodeGit = await vscode.extensions.getExtension('vscode.git')?.activate() as GitExtension
    const vscodeGitApi = vscodeGit.getAPI(1)
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uris[0])
    if (!workspaceFolder) {
        throw new Error('No workspace folder found for the given URI')
    }
    const repo = await vscodeGitApi.openRepository(workspaceFolder.uri)
    if (!repo) {
        return new Set();
    }
    const fsPaths = uris.map(uri => uri.fsPath)
    const ignores = await repo.checkIgnore(fsPaths)
    return ignores
}

async function excludeIgnores(uriEntries: Entry[]): Promise<Entry[]> {
    const uris = uriEntries.map(entry => entry.uri)
    const ignores = await checkIgnore(uris)
    const notIgnoredUriEntries = uriEntries.filter(entry => !ignores.has(entry.uri.fsPath))
    return notIgnoredUriEntries
}

interface Entry {
    name: string
    fileType: vscode.FileType
    uri: vscode.Uri
}

export async function buildTree(uri: vscode.Uri): Promise<TreeNode> {
    const segments = uri.path.split('/')
    const nodeName = segments[segments.length - 1] || ''
    const root: TreeNode = { name: nodeName }
    const stack: { node: TreeNode, uri: vscode.Uri }[] = [{ node: root, uri }]
    while (stack.length > 0) {
        const current = stack.pop()
        if (!current) {
            continue
        }
        const { node, uri: currentUri } = current
        try {
            const stat = await vscode.workspace.fs.stat(currentUri)
            if (stat.type === vscode.FileType.Directory) {
                const entries = await vscode.workspace.fs.readDirectory(currentUri)
                const uriEntries: Entry[] = entries.map(([name, fileType]) => {
                    const childUri = vscode.Uri.joinPath(currentUri, name)
                    return { name, fileType, uri: childUri }
                })
                const notIgnoredUriEntries = await excludeIgnores(uriEntries)
                const children: TreeNode[] = []

                for (const { name, fileType, uri: childUri } of notIgnoredUriEntries) {
                    const childNode: TreeNode = { name }
                    children.push(childNode)
                    if (fileType === vscode.FileType.Directory) {
                        stack.push({ node: childNode, uri: childUri })
                    }
                }

                if (children.length > 0) {
                    node.children = children
                }
            }
        } catch (error) {
            console.error('Error building tree for', currentUri.toString(), error)
        }
    }

    return root
}
