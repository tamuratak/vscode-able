import { suite, test } from 'mocha'
import { strict as assert } from 'assert'
import { generateAsciiTree, parseAsciiTree, TreeNode } from '../../../src/utils/asciitree.js'


suite('ASCII Tree Utils', () => {
    suite('generateAsciiTree', () => {
        test('should generate ASCII tree for a single node', () => {
            const tree: TreeNode = { name: 'root' }
            const expected = 'root\n'
            const result = generateAsciiTree(tree)
            assert.equal(result, expected)
        })

        test('should generate ASCII tree for a simple tree with children', () => {
            const tree: TreeNode = {
                name: 'root',
                children: [
                    { name: 'child1' },
                    { name: 'child2' }
                ]
            }
            const expected =
                'root\n' +
                '├── child1\n' +
                '└── child2\n'

            const result = generateAsciiTree(tree)
            assert.equal(result, expected)
        })

        test('should generate ASCII tree for a complex nested tree', () => {
            const tree: TreeNode = {
                name: 'root',
                children: [
                    {
                        name: 'folder1',
                        children: [
                            { name: 'file1.txt' },
                            { name: 'file2.txt' }
                        ]
                    },
                    { name: 'file3.txt' }
                ]
            }
            const expected =
                'root\n' +
                '├── folder1\n' +
                '│   ├── file1.txt\n' +
                '│   └── file2.txt\n' +
                '└── file3.txt\n'

            const result = generateAsciiTree(tree)
            assert.equal(result, expected)
        })
    })

    suite('parseAsciiTree', () => {
        test('should parse ASCII tree for a single node', () => {
            const asciiTree = 'root\n'
            const expected: TreeNode = { name: 'root' }
            const result = parseAsciiTree(asciiTree)
            assert.deepEqual(result, expected)
        })

        test('should parse ASCII tree for a simple tree with children', () => {
            const asciiTree =
                'root\n' +
                '├── child1\n' +
                '└── child2\n'

            const expected: TreeNode = {
                name: 'root',
                children: [
                    { name: 'child1' },
                    { name: 'child2' }
                ]
            }

            const result = parseAsciiTree(asciiTree)
            assert.deepEqual(result, expected)
        })

        test('should parse ASCII tree for a complex nested tree', () => {
            const asciiTree =
                'root\n' +
                '├── folder1\n' +
                '│   ├── file1.txt\n' +
                '│   └── file2.txt\n' +
                '└── file3.txt\n'

            const expected: TreeNode = {
                name: 'root',
                children: [
                    {
                        name: 'folder1',
                        children: [
                            { name: 'file1.txt' },
                            { name: 'file2.txt' }
                        ]
                    },
                    { name: 'file3.txt' }
                ]
            }

            const result = parseAsciiTree(asciiTree)
            assert.deepEqual(result, expected)
        })
    })

    suite('Round Trip', () => {
        test('should generate and parse ASCII tree without data loss', () => {
            const originalTree: TreeNode = {
                name: 'project',
                children: [
                    {
                        name: 'src',
                        children: [
                            {
                                name: 'components',
                                children: [
                                    { name: 'Button.tsx' },
                                    { name: 'Input.tsx' }
                                ]
                            },
                            {
                                name: 'utils',
                                children: [
                                    { name: 'helpers.ts' }
                                ]
                            }
                        ]
                    },
                    { name: 'README.md' },
                    { name: 'package.json' }
                ]
            }

            const asciiTree = generateAsciiTree(originalTree)
            const parsedTree = parseAsciiTree(asciiTree)

            assert.deepEqual(parsedTree, originalTree, 'Round trip conversion should produce identical tree structure')
        })

        test('should handle empty child arrays consistently', () => {
            const originalTree: TreeNode = {
                name: 'root',
                children: [
                    { name: 'leaf1' },
                    { name: 'branch', children: [] },
                    { name: 'leaf2' }
                ]
            }

            const asciiTree = generateAsciiTree(originalTree)
            const parsedTree = parseAsciiTree(asciiTree)

            // When parsing, empty children arrays might be omitted
            const expectedParsedTree: TreeNode = {
                name: 'root',
                children: [
                    { name: 'leaf1' },
                    { name: 'branch' }, // children array is omitted since it was empty
                    { name: 'leaf2' }
                ]
            }

            assert.deepEqual(parsedTree, expectedParsedTree)
        })
    })
})
