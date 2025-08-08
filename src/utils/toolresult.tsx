import { BasePromptElementProps, PromptElement, PromptPiece, renderPrompt, ToolMessage, ToolResult } from '@vscode/prompt-tsx'
import * as vscode from 'vscode'
import { Gpt4oTokenizer } from '../chat/tokenizer.js'


interface ToolResultProps extends BasePromptElementProps {
    data: vscode.LanguageModelToolResult
}

class ToolResultPrompt extends PromptElement<ToolResultProps> {
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
    const result = await renderPrompt(ToolResultPrompt, { data }, { modelMaxPromptTokens: 32768 }, gpt4oTokenizer)
    const resultpart = result.messages[0].content[0] as unknown as vscode.LanguageModelToolResultPart
    const content = resultpart.content[0] as vscode.LanguageModelTextPart
    return content.value
}
