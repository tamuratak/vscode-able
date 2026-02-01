import { BasePromptElementProps } from '@vscode/prompt-tsx'
import * as vscode from 'vscode'


export interface FileElementProps extends BasePromptElementProps {
    uri: vscode.Uri,
    content: string
}
