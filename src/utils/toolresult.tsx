import { BasePromptElementProps, PromptElement, PromptPiece, renderPrompt, TextChunk, ToolMessage, ToolResult } from '@vscode/prompt-tsx'
import * as vscode from 'vscode'
import { Gpt4oTokenizer } from '../chat/tokenizer.js'


interface ToolResultRenderingProps extends BasePromptElementProps {
    data: vscode.LanguageModelToolResult
}

class ToolResultRenderingPrompt extends PromptElement<ToolResultRenderingProps> {
    render(): PromptPiece {
        return (
            <ToolMessage toolCallId='dummyid'>
                <ToolResult data={this.props.data} />
            </ToolMessage>
        )
    }
}

export async function renderToolResult(data: vscode.LanguageModelToolResult) {
    const gpt4oTokenizer = new Gpt4oTokenizer()
    const result = await renderPrompt(ToolResultRenderingPrompt, { data }, { modelMaxPromptTokens: 32768 }, gpt4oTokenizer)
    const content = result.messages[0].content
    if (typeof content === 'string') {
        return content
    } else {
        let value = ''
        for (const c of content) {
            if (c.type === 'text') {
                value += c.text
            }
        }
        return value
    }
}

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
