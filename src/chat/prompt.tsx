/* eslint-disable  @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import {
    AssistantMessage,
    BasePromptElementProps,
    PrioritizedList,
    PromptElement,
    PromptPiece,
    UserMessage,
} from '@vscode/prompt-tsx'
import type { RequestCommands } from './chat.js'


export interface HistoryEntry {
    type: 'user' | 'assistant',
    command?: RequestCommands | undefined,
    text: string
}

export interface InputProps extends HistoryMessagesProps {
    input: string
}

export class SimplePrompt extends PromptElement<InputProps> {
    render() {
        return (
            <>
                <HistoryMessages history={this.props.history} />
                <UserMessage>
                    {this.props.input}
                </UserMessage>
            </>
        )
    }
}

class MakeFluent extends PromptElement {
    render() {
        return (
            <UserMessage>
                Make fluent:
                <br />
                {this.props.children}
            </UserMessage>
        )
    }
}

export class FluentPrompt extends PromptElement<InputProps> {
    render() {
        return (
            <>
                <UserMessage>
                    Instructions:
                    <br />
                    Please write a clear, concise, and grammatically correct English sentence that effectively conveys the idea. The tone should be formal, and it should be neutral. Do not use codeblocks in the output.
                </UserMessage>
                <PrioritizedList priority={100} descending={false}>
                    <MakeFluent>
                        The following error message pops up. The message doesn't mention that  the terminal launch attempt from the `tasks.json` file has failed. Users cannot tell which configuration is wrong.
                    </MakeFluent>
                    <AssistantMessage>
                        The following error message appears, but it doesn't indicate that the terminal launch attempt from the `tasks.json` file has failed. As a result, users are unable to identify which configuration is incorrect.
                    </AssistantMessage>
                    <MakeFluent>
                        Users are unable to identify that the terminal launch attempt from the `tasks.json` file has failed.
                    </MakeFluent>
                    <AssistantMessage>
                        Users cannot recognize that the terminal launch attempt from the `tasks.json` file has failed.
                    </AssistantMessage>
                    <MakeFluent>
                        The position of the IME widget is not good at the last of a long line.
                    </MakeFluent>
                    <AssistantMessage>
                        The position of the IME widget is not ideal at the end of a long line.
                    </AssistantMessage>
                </PrioritizedList>
                <HistoryMessages history={this.props.history} />
                <MakeFluent>
                    {this.props.input}
                </MakeFluent>
            </>
        )
    }
}

class MakeFluentJa extends PromptElement {
    render() {
        return (
            <UserMessage>
                以下の文章を、自然で流暢な日本語に書き換えてください:
                <br />
                {this.props.children}
            </UserMessage>
        )
    }
}

export class FluentJaPrompt extends PromptElement<InputProps> {
    render() {
        return (
            <>
                <UserMessage>
                    指示:
                    <br />
                    元の意味や意図を損なわないようにしつつ、読みやすく丁寧な表現にしてください。
                </UserMessage>
                <HistoryMessages history={this.props.history} />
                <MakeFluentJa>
                    {this.props.input}
                </MakeFluentJa>
            </>
        )
    }
}

class ToEn extends PromptElement {
    render() {
        return (
            <UserMessage>
                Translate the following sentence literally into natural English:
                <br />
                {this.props.children}
            </UserMessage>
        )
    }
}

export class ToEnPrompt extends PromptElement<InputProps> {
    render() {
        return (
            <>
                <UserMessage>
                    Instructions:
                    <br />
                    Please preserve the original tone and meaning. If the context is ambiguous, make reasonable assumptions to ensure the translation sounds fluent and contextually appropriate.
                </UserMessage>
                <HistoryMessages history={this.props.history} />
                <ToEn>
                    {this.props.input}
                </ToEn>
            </>
        )
    }
}

class ToJa extends PromptElement {
    render() {
        return (
            <UserMessage>
                Please translate the following text into natural and fluent Japanese:
                <br />
                {this.props.children}
            </UserMessage>
        )
    }
}

export class ToJaPrompt extends PromptElement<InputProps> {
    render() {
        return (
            <>
                <UserMessage>
                    Instructions:
                    <br />
                    Please preserve the original tone and meaning. If the context is ambiguous, make reasonable assumptions to ensure the translation sounds fluent and contextually appropriate.
                </UserMessage>
                <ToJa>
                    The symptoms suggest it might be a hardware error.
                </ToJa>
                <AssistantMessage>
                    症状からすると、ハードウェアのエラーの可能性があります。
                </AssistantMessage>
                <ToJa>
                    I would like to request an additional cleaning for the kitchen drain.
                </ToJa>
                <AssistantMessage>
                    追加でキッチンの排水口のクリーニングを希望します。
                </AssistantMessage>
                <HistoryMessages history={this.props.history} />
                <ToJa>
                    {this.props.input}
                </ToJa>
            </>
        )
    }
}

interface HistoryMessagesProps extends BasePromptElementProps {
    history: HistoryEntry[]
}

class HistoryMessages extends PromptElement<HistoryMessagesProps> {
    render(): PromptPiece {
        const history: (UserMessage | AssistantMessage)[] = []
        for (const hist of this.props.history) {
            if (hist.type === 'user') {
                if (hist.command === 'fluent') {
                    history.push(
                        <MakeFluent>
                            {hist.text}
                        </MakeFluent>
                    )
                } else if (hist.command === 'to_en') {
                    history.push(
                        <ToEn>
                            {hist.text}
                        </ToEn>
                    )
                } else {
                    history.push(<UserMessage>{hist.text}</UserMessage>)
                }
            } else {
                history.push(<AssistantMessage>{hist.text}</AssistantMessage>)
            }
        }
        return (
            <>
                <PrioritizedList priority={0} descending={false}>
                    {history.slice(0, -10)}
                </PrioritizedList>
                <PrioritizedList priority={1000} descending={false}>
                    {history.slice(-10)}
                </PrioritizedList>
            </>
        )
    }
}
