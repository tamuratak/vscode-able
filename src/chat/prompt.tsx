import {
    AssistantMessage,
    BasePromptElementProps,
    PromptElement,
    UserMessage,
} from '@vscode/prompt-tsx';

export interface PromptProps extends BasePromptElementProps {
    userQuery: string
}

export interface PromptState {
    creationScript: string
}

export const MAKE_FLUENT_PROMPT = 'Make fluent:'

export class FluentPrompt extends PromptElement<PromptProps, PromptState> {
    async render() {
        return (
            <>
                <UserMessage>
                    Instructions:
                    <br />
                    Please write a clear, concise, and grammatically correct English sentence that effectively conveys the idea. The tone should be formal, and it should be neutral. Do not use codeblocks in the output.
                </UserMessage>
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
            </>
        )
    }
}
