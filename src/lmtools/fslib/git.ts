import * as vscode from 'vscode'
import type { GitExtension } from '../../../types/vscodegit/git.js'
import { DirEntry } from '../../utils/dir.js';

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

export async function excludeIgnores(uriEntries: DirEntry[]): Promise<DirEntry[]> {
    const uris = uriEntries.map(entry => entry.uri)
    const ignores = await checkIgnore(uris)
    const notIgnoredUriEntries = uriEntries.filter(entry => !ignores.has(entry.uri.fsPath))
    return notIgnoredUriEntries
}
