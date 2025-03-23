import * as assert from 'node:assert'
import * as vscode from 'vscode'
import { buildTree } from '../../../src/lmtools/fslib/buildtree.js'


suite('fslib test suite', () => {

    test('buildTree test', async () => {
        const workspaceUri = vscode.workspace.workspaceFolders?.[0].uri
        if (!workspaceUri) {
            assert.fail('No workspace folder found')
        }
        const repo01Uri = vscode.Uri.joinPath(workspaceUri, 'repositorytree01')
        const tree = await buildTree(repo01Uri)
        assert.deepStrictEqual(
            tree,
            {
                name: 'repositorytree01',
                children: [
                    {
                        name: 'src',
                        children: [
                            {
                                name: 'lib',
                                children: [
                                    {
                                        name: 'lib01.ts'
                                    },
                                    {
                                        name: 'lib02.ts'
                                    }
                                ]
                            },
                            {
                                name: 'main.ts'
                            }
                        ]
                    },
                    {
                        name: 'test',
                        children: [
                            {
                                name: 'main.test.ts'
                            }
                        ]
                    }
                ]
            }
        )
    })

})
