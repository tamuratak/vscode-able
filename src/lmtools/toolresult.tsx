import { BasePromptElementProps, PromptElement, PromptPiece, TextChunk } from '@vscode/prompt-tsx'
import { Tag } from '../utils/tag.js'


interface CommandResultPromptProps extends BasePromptElementProps {
    stdout: string,
    stderr: string,
    exitCode: number | null,
    signal: NodeJS.Signals | null
}

export class CommandResultPrompt extends PromptElement<CommandResultPromptProps> {
    render(): PromptPiece {
        return (
            <>
                <Tag name='stdout'>
                    <TextChunk breakOn=' '>
                        {this.props.stdout}
                    </TextChunk>
                </Tag>
                <Tag name='stderr'>
                    <TextChunk breakOn=' '>
                        {this.props.stderr}
                    </TextChunk>
                </Tag>
                <Tag name='exitCode'>
                    {this.props.exitCode}
                </Tag>
                <Tag name='exitSignal'>
                    {this.props.signal ?? ''}
                </Tag>
            </>
        )
    }
}

