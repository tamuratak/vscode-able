import {
    AssistantMessage,
    BasePromptElementProps,
    PrioritizedList,
    PromptElement,
    PromptPiece,
    ToolCall,
    ToolMessage,
    ToolResult,
    UserMessage,
} from '@vscode/prompt-tsx'
import type { RequestCommands } from './chat.js'
import * as vscode from 'vscode'
import { FileElement, FileElementProps } from './promptlib/fsprompts.js'

/* eslint-disable  @typescript-eslint/no-namespace */
declare global {
    namespace JSX {
        type Element = PromptPiece
        type ElementClass = PromptElement
    }
}

export interface HistoryEntry {
    type: 'user' | 'assistant',
    command?: RequestCommands | undefined,
    text: string
}

export interface ToolCallResultPair {
    toolCall: ToolCall
    toolResult: vscode.LanguageModelToolResult
}

export interface ToolCallResultRoundProps extends BasePromptElementProps {
    responseStr: string
    toolCallResultPairs: ToolCallResultPair[]
}

export class ToolCallResultRoundElement extends PromptElement<ToolCallResultRoundProps> {
    render(): PromptPiece {
        const assistantToolCalls: ToolCall[] = this.props.toolCallResultPairs.map((e) => e.toolCall)
        const toolResultParts: { toolCallId: string, toolResult: vscode.LanguageModelToolResult }[] = this.props.toolCallResultPairs.map((e) => (
            { toolCallId: e.toolCall.id, toolResult: e.toolResult }
        ))
        return (
            <>
                <AssistantMessage toolCalls={assistantToolCalls}>
                    {this.props.responseStr}
                </AssistantMessage>
                {
                    toolResultParts.map((e) => (
                        <ToolMessage toolCallId={e.toolCallId}>
                            <ToolResult data={e.toolResult} />
                        </ToolMessage>
                    ))
                }
            </>
        )
    }
}

export class ToolResultDirectiveElement extends PromptElement {
    render(): PromptPiece {
        return (
            <UserMessage>
                - Above is the result of calling one or more tools. <br />
                - Always trust the result over your own knowledge. <br />
                - Answer using the natural language of the user.
            </UserMessage>
        )
    }
}

export interface MainPromptProps extends HistoryMessagesProps, AttachmentsProps {
    input: string
    userInstruction?: string | undefined
    toolCallResultRounds?: ToolCallResultRoundProps[] | undefined
}

export class SimplePrompt extends PromptElement<MainPromptProps> {
    render(): PromptPiece {
        return (
            <>
                <HistoryMessages history={this.props.history} />
                <Attachments attachments={this.props.attachments} />
                <UserMessage>
                    {this.props.input}
                </UserMessage>
            </>
        )
    }
}

export class PythonMasterPrompt extends PromptElement<MainPromptProps> {
    render(): PromptPiece {
        return (
            <>
                <UserMessage>
                    Instructions:<br />
                    - When answering a question that requires executing Python code, use able_python. <br />
                    - Answer the question when you think the result of the Python execution is correct. <br />
                    - Always trust the Python execution result over your own knowledge.
                </UserMessage>
                <HistoryMessages history={this.props.history} />
                <Attachments attachments={this.props.attachments} />
                <UserMessage>
                    {this.props.input}
                </UserMessage>
            </>
        )
    }
}

class MakeFluent extends PromptElement {
    render(): PromptPiece {
        return (
            <UserMessage>
                Make fluent:
                <br />
                {this.props.children}
            </UserMessage>
        )
    }
}

export class FluentPrompt extends PromptElement<MainPromptProps> {
    render(): PromptPiece {
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
                <UserMessage>
                    {this.props.userInstruction ? 'Instructions: ' + this.props.userInstruction : ''}
                </UserMessage>
                <MakeFluent>
                    {this.props.input}
                </MakeFluent>
            </>
        )
    }
}

class MakeFluentJa extends PromptElement {
    render(): PromptPiece {
        return (
            <UserMessage>
                以下の文章を、自然で流暢な日本語に書き換えてください:
                <br />
                {this.props.children}
            </UserMessage>
        )
    }
}

export class FluentJaPrompt extends PromptElement<MainPromptProps> {
    render(): PromptPiece {
        return (
            <>
                <UserMessage>
                    指示:
                    <br />
                    元の意味や意図を損なわないようにしつつ、読みやすく丁寧な表現にしてください。
                </UserMessage>
                <PrioritizedList priority={100} descending={false}>
                    <MakeFluentJa>
                        複文ではなく単文で書きかつ、文は1つで書くよう命令するためのプロンプト。
                    </MakeFluentJa>
                    <AssistantMessage>
                        複文ではなく単文で、しかも文を1つだけ書くよう指示するためのプロンプト。
                    </AssistantMessage>
                </PrioritizedList>
                <HistoryMessages history={this.props.history} />
                <UserMessage>
                    {this.props.userInstruction ? '指示: ' + this.props.userInstruction : ''}
                </UserMessage>
                <MakeFluentJa>
                    {this.props.input}
                </MakeFluentJa>
            </>
        )
    }
}

class ToEn extends PromptElement {
    render(): PromptPiece {
        return (
            <UserMessage>
                Translate the following sentence literally into natural English:
                <br />
                {this.props.children}
            </UserMessage>
        )
    }
}

export class ToEnPrompt extends PromptElement<MainPromptProps> {
    render(): PromptPiece {
        return (
            <>
                <UserMessage>
                    Instructions:
                    <br />
                    Please preserve the original tone and meaning. If the context is ambiguous, make reasonable assumptions to ensure the translation sounds fluent and contextually appropriate.
                </UserMessage>
                <HistoryMessages history={this.props.history} />
                <UserMessage>
                    {this.props.userInstruction ? 'Instructions: ' + this.props.userInstruction : ''}
                </UserMessage>
                <ToEn>
                    {this.props.input}
                </ToEn>
            </>
        )
    }
}

class ToJa extends PromptElement {
    render(): PromptPiece {
        return (
            <UserMessage>
                Please translate the following text into natural and fluent Japanese:
                <br />
                {this.props.children}
            </UserMessage>
        )
    }
}

export class ToJaPrompt extends PromptElement<MainPromptProps> {
    render(): PromptPiece {
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
                <UserMessage>
                    {this.props.userInstruction ? '指示: ' + this.props.userInstruction : ''}
                </UserMessage>
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
        const history: PromptPiece[] = []
        for (const hist of this.props.history) {
            if (hist.type === 'user') {
                if (hist.command === 'fluent') {
                    history.push(
                        <MakeFluent>
                            {hist.text}
                        </MakeFluent>
                    )
                } else if (hist.command === 'fluent_ja') {
                    history.push(
                        <MakeFluentJa>
                            {hist.text}
                        </MakeFluentJa>
                    )
                } else if (hist.command === 'to_en') {
                    history.push(
                        <ToEn>
                            {hist.text}
                        </ToEn>
                    )
                } else if (hist.command === 'to_ja') {
                    history.push(
                        <ToJa>
                            {hist.text}
                        </ToJa>
                    )
                } else {
                    hist.command satisfies undefined
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


interface AttachmentsProps extends BasePromptElementProps {
    attachments?: FileElementProps[] | undefined
}

export class Attachments extends PromptElement<AttachmentsProps> {
    render(): PromptPiece {
        return (
            <>
                {
                    this.props.attachments?.map((attachment) =>
                        <UserMessage>
                            <FileElement
                                uri={attachment.uri}
                                content={attachment.content}
                                description='This file was attached for context and should be used only as a reference when executing my instructions. Do not edit it.'
                                metadata={attachment.metadata}
                            />
                        </UserMessage>
                    ) ?? ''
                }
            </>
        )
    }
}
