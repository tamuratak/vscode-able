
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
