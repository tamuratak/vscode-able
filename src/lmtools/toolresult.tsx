import { BasePromptElementProps, PromptElement, PromptPiece, TextChunk } from '@vscode/prompt-tsx'
import { DefinitionMetadata } from './annotation.js'
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

interface TypeDefinitionProps extends BasePromptElementProps {
    type: string
    definitionMetadata: DefinitionMetadata
}

export class TypeDefinitionTag extends PromptElement<TypeDefinitionProps> {
    render(): PromptPiece {
        return (
            <Tag name='type-definition' attrs={{
                typename: this.props.type,
                filePath: this.props.definitionMetadata.filePath,
                startLine: this.props.definitionMetadata.startLine
            }}>
                {this.props.definitionMetadata.definitionText ?? '[fail to retrieve definition]'}
            </Tag>
        )
    }
}
