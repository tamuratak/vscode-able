import { BasePromptElementProps, PromptElement, PromptPiece, TextChunk } from '@vscode/prompt-tsx'


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
                <TextChunk breakOn=' '>
                    ### stdout <br />
                    {this.props.stdout}
                </TextChunk>
                <br /><br />
                <TextChunk breakOn=' '>
                    ### stderr <br />
                    {this.props.stderr}
                    <br /><br />

                    ### exit code  <br />
                    {this.props.exitCode}
                    <br /><br />

                    ### exit signal <br />
                    {this.props.signal}
                </TextChunk>
            </>
        )
    }
}
