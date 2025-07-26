import * as vscode from 'vscode'
import type { GitExtension } from '../../types/git/git.js';

export function getGitApi(): GitExtension | undefined {
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    return gitExtension?.isActive ? gitExtension.exports : undefined;
}

export function getWorkspaceGitDiff(gitExtension: GitExtension) {
    const workspaceUri = vscode.workspace.workspaceFolders?.[0].uri
    if (!workspaceUri) {
        return
    }
    const git = gitExtension.getAPI(1)
    const repo = git.getRepository(workspaceUri)
    if (!repo) {
        return
    }
    return repo.diff()
}
