/* eslint-disable  @typescript-eslint/no-unsafe-return */
import {
    BasePromptElementProps,
    PromptElement,
    PromptPiece
} from '@vscode/prompt-tsx'
import * as vscode from 'vscode'


export interface FileElementProps extends BasePromptElementProps {
    uri: vscode.Uri,
    content: string,
    description?: string | undefined,
    metadata?: Map<string, string> | undefined,
}

export class FileElement extends PromptElement<FileElementProps> {
    render(): PromptPiece {
        const metadata = this.props.metadata ? [...this.props.metadata] : []
        return (
            <>
                ### File: {this.props.uri.fsPath}<br />
                Metadata:<br />
                - Description: {this.props.description ?? 'No description provided'}<br />
                {
                    metadata.map(([key, value]) => (
                        <>  - {key}: {value}<br /></>
                    ))
                }
                <br />
                Content:<br />
                {this.props.content}
            </>
        )
    }
}

export interface FileEntry {
    name: string,
    uri: vscode.Uri,
    type: vscode.FileType,
}

export interface DirElementProps extends BasePromptElementProps {
    uri: vscode.Uri,
    entries: FileEntry[]
}

function getFileTypeString(type: vscode.FileType): string {
    switch (type) {
        case vscode.FileType.File:
            return 'File'
        case vscode.FileType.Directory:
            return 'Directory'
        case vscode.FileType.SymbolicLink:
            return 'Symbolic Link'
        case vscode.FileType.Unknown:
            return 'Unknown'
        default:
            return 'Unknown'
    }
}


export class DirElement extends PromptElement<DirElementProps> {
    render(): PromptPiece {
        return (
            <>
                ### Directory: {this.props.uri.fsPath}<br />
                Entries:<br />
                {
                    this.props.entries.map((entry) => (
                        <>- {entry.name} ({getFileTypeString(entry.type)})<br /></>
                    ))
                }
            </>
        )
    }
}
