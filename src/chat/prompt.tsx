import {
    AssistantMessage,
    BasePromptElementProps,
    PrioritizedList,
    PromptElement,
    PromptPiece,
    UserMessage,
} from '@vscode/prompt-tsx'
import type { RequestCommands } from './chat'


export interface HistoryEntry {
    type: 'user' | 'assistant',
    command?: RequestCommands | undefined,
    text: string
}

export interface SimplePromptProps extends BasePromptElementProps {
    history: HistoryEntry[],
    prompt: string
}

export class SimplePrompt extends PromptElement<SimplePromptProps> {
    render() {
        return (
            <>
                <HistoryMessages history={this.props.history} />
                <UserMessage>
                    {this.props.prompt}
                </UserMessage>
            </>
        )
    }
}

export const MAKE_FLUENT_PROMPT = 'Make fluent:'

export interface FluentPromptProps extends BasePromptElementProps {
    history: HistoryEntry[],
    input: string
}

export class FluentPrompt extends PromptElement<FluentPromptProps> {
    render() {
        return (
            <>
                <UserMessage>
                    Instructions:
                    <br />
                    Please write a clear, concise, and grammatically correct English sentence that effectively conveys the idea. The tone should be formal, and it should be neutral. Do not use codeblocks in the output.
                </UserMessage>
                <PrioritizedList priority={100} descending={false}>
                    <UserMessage>
                        {MAKE_FLUENT_PROMPT}
                        <br />
                        The following error message pops up. The message doesn't mention that  the terminal launch attempt from the `tasks.json` file has failed. Users cannot tell which configuration is wrong.
                    </UserMessage>
                    <AssistantMessage>
                        The following error message appears, but it doesn't indicate that the terminal launch attempt from the `tasks.json` file has failed. As a result, users are unable to identify which configuration is incorrect.
                    </AssistantMessage>
                    <UserMessage>
                        {MAKE_FLUENT_PROMPT}
                        <br />
                        Users are unable to identify that the terminal launch attempt from the `tasks.json` file has failed.
                    </UserMessage>
                    <AssistantMessage>
                        Users cannot recognize that the terminal launch attempt from the `tasks.json` file has failed.
                    </AssistantMessage>
                    <UserMessage>
                        {MAKE_FLUENT_PROMPT}
                        <br />
                        The position of the IME widget is not good at the last of a long line.
                    </UserMessage>
                    <AssistantMessage>
                        The position of the IME widget is not ideal at the end of a long line.
                    </AssistantMessage>
                </PrioritizedList>
                <HistoryMessages history={this.props.history} />
                <UserMessage>
                    {MAKE_FLUENT_PROMPT}
                    <br />
                    {this.props.input}
                </UserMessage>
            </>
        )
    }
}

interface HistoryMessagesProps extends BasePromptElementProps {
    history: HistoryEntry[]
}

export class HistoryMessages extends PromptElement<HistoryMessagesProps> {
    render(): PromptPiece {
        const history: (UserMessage | AssistantMessage)[] = [];
        for (const hist of this.props.history) {
            if (hist.type === 'user') {
                if (hist.command === 'fluent') {
                    history.push(
                        <UserMessage>
                            {MAKE_FLUENT_PROMPT}
                            <br />
                            {hist.text}
                        </UserMessage>
                    )
                } else {
                    history.push(<UserMessage>{hist.text}</UserMessage>)
                }
            } else {
                history.push(<AssistantMessage>{hist.text}</AssistantMessage>)
            }
        }
        return (
            <PrioritizedList priority={0} descending={false}>
                {history}
            </PrioritizedList>
        );
    }
}
