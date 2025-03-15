import { LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult } from 'vscode'
import * as vscode from 'vscode'
import { findWorkspaceFileUri } from '../utils/uri.js'
import { buildTree } from './fslib/buildtree.js'
import { generateAsciiTree } from '../utils/asciitree.js'
import { renderElementJSON } from '@vscode/prompt-tsx'
import { DirElement } from '../chat/promptlib/fsprompts.js'
import { readDir } from '../utils/dir.js'

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

export class RepositoryTreeTool implements LanguageModelTool<void> {

    constructor(private readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
    }) { }

    async invoke(options: LanguageModelToolInvocationOptions<void>) {
        this.extension.outputChannel.debug(`RepositoryTreeTool input: ${JSON.stringify(options.input, null, 2)}`)
        const workspaceFolders = vscode.workspace.workspaceFolders?.[0]
        const dir = workspaceFolders?.uri.path
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

interface ListDirInput {
    dir: string
}

export class ListDirTool implements LanguageModelTool<ListDirInput> {

    constructor(private readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
    }) { }

    async invoke(options: LanguageModelToolInvocationOptions<ListDirInput>) {
        this.extension.outputChannel.debug(`ListDirTool input: ${JSON.stringify(options.input, null, 2)}`)
        const dirUri = await findWorkspaceFileUri(options.input.dir)
        if (!dirUri) {
            const message = `ListDirTool uri is undefined: ${options.input.dir}`
            this.extension.outputChannel.error(message)
            throw new Error(message)
        }
        const entriesWithUri = await readDir(dirUri)
        const json = await renderElementJSON(DirElement, { uri: dirUri, entries: entriesWithUri }, options.tokenizationOptions )
        const promptPart = new vscode.LanguageModelToolResult([new vscode.LanguageModelPromptTsxPart(json)])
        return promptPart
    }

}
