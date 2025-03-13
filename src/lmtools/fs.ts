import { LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult } from 'vscode'
import * as vscode from 'vscode'
import { findWorkspaceFileUri } from '../utils/uri.js'
import { buildTree } from './fslib/buildtree.js'
import { generateAsciiTree } from '../utils/asciitree.js'


interface ReadFileInput {
    file: string
}

export class ReadFileTool implements LanguageModelTool<ReadFileInput> {

    constructor(private readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
    }) { }

    async invoke(options: LanguageModelToolInvocationOptions<ReadFileInput>) {
        this.extension.outputChannel.debug(`ReadFileTool input: ${JSON.stringify(options.input, null, 2)}`)
        const uri = await findWorkspaceFileUri(options.input.file)
        if (!uri) {
            const message = `ReadFileTool uri is undefined: ${options.input.file}`
            this.extension.outputChannel.error(message)
            throw new Error(message)
        }
        const fileUint8Array = await vscode.workspace.fs.readFile(uri)
        const fileText = new TextDecoder().decode(fileUint8Array)
        return new LanguageModelToolResult([new LanguageModelTextPart(fileText)])
    }

}

interface RepositoryTreeInput {
    dir?: string | undefined
}

export class RepositoryTreeTool implements LanguageModelTool<RepositoryTreeInput | undefined> {

    constructor(private readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
    }) { }

    async invoke(options: LanguageModelToolInvocationOptions<RepositoryTreeInput>) {
        this.extension.outputChannel.debug(`RepositoryTreeTool input: ${JSON.stringify(options.input, null, 2)}`)
        let dir = options.input?.dir
        if (!dir) {
            const workspaceFolders = vscode.workspace.workspaceFolders?.[0]
            dir = workspaceFolders?.uri.path
        }
        if (!dir) {
            const message = 'RepositoryTreeTool dir is undefined'
            this.extension.outputChannel.error(message)
            throw new Error(message)
        }

        const uri = await findWorkspaceFileUri(dir)
        if (!uri) {
            const message = `RepositoryTreeTool uri is undefined: ${dir}`
            this.extension.outputChannel.error(message)
            throw new Error(message)
        }
        const tree = await buildTree(uri)
        const asciitree = generateAsciiTree(tree)

        this.extension.outputChannel.debug(`RepositoryTreeTool ascii tree: ${asciitree}`)
        return new LanguageModelToolResult([new LanguageModelTextPart(asciitree)])
    }

}

