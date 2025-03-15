import * as vscode from 'vscode'
import { TreeNode } from '../../utils/asciitree.js'
import { excludeIgnores } from './git.js'
import { DirEntry } from '../../utils/dir.js'


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
                const uriEntries: DirEntry[] = entries.map(([name, fileType]) => {
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
