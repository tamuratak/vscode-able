/**
 * Node interface representing a tree structure
 */
export interface TreeNode {
    name: string
    children?: TreeNode[] | undefined
}

/**
 * Generate ASCII art representation of a tree structure
 * @param tree Root node of the tree
 * @param indent Optional initial indentation string
 * @returns String containing the ASCII tree representation
 */
export function generateAsciiTree(tree: TreeNode, indent = ''): string {
    let result = `${tree.name}\n`

    if (tree.children && tree.children.length > 0) {
        for (let i = 0; i < tree.children.length; i++) {
            const child = tree.children[i]
            const isLastChild = i === tree.children.length - 1

            // Use different symbols for the last child
            const prefix = isLastChild ? '└── ' : '├── '
            const childIndent = indent + (isLastChild ? '    ' : '│   ')

            result += `${indent}${prefix}${generateAsciiTree(child, childIndent)}`
        }
    }

    return result
}

/**
 * Parse an ASCII tree representation back into a TreeNode structure
 * @param asciiTree String containing the ASCII tree representation
 * @returns The parsed TreeNode structure
 */
export function parseAsciiTree(asciiTree: string): TreeNode | null {
    const lines = asciiTree.trim().split('\n')
    if (lines.length === 0) { return null }

    const rootName = lines[0].trim()
    const root: TreeNode = { name: rootName }
    const children: TreeNode[] = []

    let parentStack: TreeNode[] = [root]

    for (const line of lines) {
        const { depth, name, isLast } = parseTreeLine(line)
        if (name !== undefined) {
            const node: TreeNode = { name }
            if (depth === 0) {
                children.push(node)
            } else {
                /**
                Pop the stack to the correct depth. This is necessary to ensure that we are at the correct parent level.
                Consider an ASCII tree like:

                root
                ├── child1
                │   ├── grandchild1
                │   └── grandchild2
                └── child2

                When processing the line for grandchild2, the stack might initially look like this:

                [ root, child1, grandchild1 ]

                Because grandchild2 is a sibling of grandchild1 (i.e., its depth is one less),
                we need to remove grandchild1 from the stack and then attach grandchild2 to child1.
                The slice(0, depth + 1) operation ensures that the stack only includes [ root, child1 ]
                (i.e., the correct parent levels) before pushing grandchild2.
                */
                parentStack = parentStack.slice(0, depth + 1)
                const parent = parentStack[depth]
                if (!parent.children) {
                    parent.children = []
                }
                parent.children.push(node)
            }
            if (isLast) {
                parentStack.pop()
                parentStack.push(node)
            } else {
                parentStack.push(node)
            }
        }
    }

    if (children.length > 0) {
        root.children = children
    }
    return root
}

function parseTreeLine(line: string): { depth: number, name: string | undefined, isLast: boolean } {
    // Extract the prefix before the branch token
    const prefixMatch = line.match(/^(.*?)(?:├──|└──)/)
    const prefix = prefixMatch ? prefixMatch[1] : ''
    const depth = (prefix.match(/│/g) || []).length

    const nameMatch = line.match(/(?:├──|└──)\s*(.*)/)
    const name = nameMatch ? nameMatch[1].trim() : undefined
    const isLast = nameMatch !== null && line.includes('└──')
    return { depth, name, isLast };
}
