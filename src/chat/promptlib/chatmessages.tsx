
import {
    AssistantMessage,
    BasePromptElementProps,
    OpenAI,
    PrioritizedList,
    PromptElement,
    PromptPiece,
    SystemMessage,
    ToolMessage,
    UserMessage,
} from '@vscode/prompt-tsx'
import * as vscode from 'vscode'


/**
 * Utility classes to convert an array of chat messages into their corresponding @vscode/prompt-tsx components.
 * It loops over each chat message, checks the message role, and renders the proper component after processing its content.
 */

export interface VscodeChatMessagesProps extends BasePromptElementProps {
    messages: vscode.LanguageModelChatMessage[]
}

export class VscodeChatMessages extends PromptElement<VscodeChatMessagesProps> {
    render(): PromptPiece {
        const messages: PromptPiece[] = []
        for (const mesg of this.props.messages) {
            if (mesg.role === vscode.LanguageModelChatMessageRole.User) {
                for (const part of mesg.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        messages.push(<UserMessage>{part.value}</UserMessage>)
                    } else if (part instanceof vscode.LanguageModelToolResultPart) {
                        let content = ''
                        for (const txt of part.content) {
                            if (txt instanceof vscode.LanguageModelTextPart) {
                                content += txt.value
                            }
                        }
                        messages.push(<ToolMessage toolCallId={part.callId}>{content}</ToolMessage>)
                    }
                }
            } else if (mesg.role === vscode.LanguageModelChatMessageRole.Assistant) {
                for (const part of mesg.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        messages.push(<AssistantMessage>{part.value}</AssistantMessage>)
                    } else if (part instanceof vscode.LanguageModelToolCallPart) {
                        messages.push(
                            <AssistantMessage toolCalls={[{
                                id: part.callId,
                                type: 'function',
                                function: { name: part.name, arguments: JSON.stringify(part.input) }
                            }]}></AssistantMessage>
                        )
                    }
                }
            }
        }
        return (
            <>
                <PrioritizedList priority={0} descending={false}>
                    {messages.slice(0, -10)}
                </PrioritizedList>
                <>
                    {messages.slice(-10)}
                </>
            </>
        )
    }
}

interface OpenAIChatMessagesProps extends BasePromptElementProps {
    messages: OpenAI.ChatMessage[];
}

export class OpenAIChatMessages extends PromptElement<OpenAIChatMessagesProps> {
    render(): PromptPiece {
        const messages: PromptPiece[] = []
        for (const mesg of this.props.messages) {
            if (mesg.role === OpenAI.ChatRole.User) {
                messages.push(<UserMessage name={mesg.name ?? ''}>{processContent(mesg.content)}</UserMessage>);
            } else if (mesg.role === OpenAI.ChatRole.Assistant) {
                if (mesg.tool_calls && mesg.tool_calls.length > 0) {
                    messages.push(
                        <AssistantMessage name={mesg.name ?? ''} toolCalls={mesg.tool_calls}>
                            {processContent(mesg.content)}
                        </AssistantMessage>
                    )
                } else {
                    messages.push(<AssistantMessage name={mesg.name ?? ''}>{processContent(mesg.content)}</AssistantMessage>)
                }
            } else if (mesg.role === OpenAI.ChatRole.Tool) {
                messages.push(<ToolMessage toolCallId={mesg.tool_call_id ?? ''}>{processContent(mesg.content)}</ToolMessage>)
            } else if (mesg.role === OpenAI.ChatRole.System) {
                messages.push(<SystemMessage name={mesg.name ?? ''}>{processContent(mesg.content)}</SystemMessage>)
            }
        }
        return (
            <>
                <PrioritizedList priority={0} descending={false}>
                    {messages.slice(0, -10)}
                </PrioritizedList>
                <>
                    {messages.slice(-10)}
                </>
            </>
        );
    }
}

function processContent(content: string | OpenAI.ChatCompletionContentPart[] | undefined | null): string {
    if (typeof content === 'string') {
        return content
    } else if (Array.isArray(content)) {
        let result = ''
        for (const part of content) {
            if (part.type === 'text') {
                result += part.text
            }
        }
        return result
    } else {
        return ''
    }
}
