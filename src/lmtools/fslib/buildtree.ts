import * as vscode from 'vscode'
import { TreeNode } from '../../utils/asciitree.js'

export async function buildTree(uri: vscode.Uri): Promise<TreeNode> {
    const segments = uri.path.split('/')
    const nodeName = segments[segments.length - 1] || ''
    const root: TreeNode = { name: nodeName }
    // Stack items consist of the TreeNode representing the directory and its corresponding URI
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
                const children: TreeNode[] = []

                for (const [name, fileType] of entries) {
                    const childUri = vscode.Uri.joinPath(currentUri, name)
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
