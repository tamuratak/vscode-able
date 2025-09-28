import { BasePromptElementProps, PromptElement, PromptPiece, renderPrompt, ToolMessage, ToolResult } from '@vscode/prompt-tsx'
import * as vscode from 'vscode'
import { ZeroCountTokenizer } from '../chat/tokenizer.js'


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
    const zeroCountTokenizer = new ZeroCountTokenizer()
    const result = await renderPrompt(ToolResultRenderingPrompt, { data }, { modelMaxPromptTokens: 32768 }, zeroCountTokenizer)
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

export async function renderToolResultPart(part: vscode.LanguageModelToolResultPart | vscode.LanguageModelToolResultPart2) {
    const contents = part.content.filter(c => c instanceof vscode.LanguageModelTextPart || c instanceof vscode.LanguageModelPromptTsxPart)
    const toolResult = new vscode.LanguageModelToolResult(contents)
    return renderToolResult(toolResult)
}
