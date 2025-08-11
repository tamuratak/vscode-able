import { BasePromptElementProps, PromptElement, PromptPiece, renderPrompt, ToolMessage, ToolResult } from '@vscode/prompt-tsx'
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
