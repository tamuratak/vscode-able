import * as vscode from 'vscode'

const BASE_PROMPT = 'Make fluent:'

function make_fluent_prompt(input: string) {
    return BASE_PROMPT + '\n' + input
}

let fluentMessages = [
    vscode.LanguageModelChatMessage.User('Instructions: \nPlease write a clear, concise, and grammatically correct English sentence that effectively conveys the idea. The tone should be formal, and it should be neutral. Do not use codeblocks in the output.'),
    vscode.LanguageModelChatMessage.User(BASE_PROMPT + '\n' + 'The following error message pops up. The message doesn\'t mention that  the terminal launch attempt from the `tasks.json` file has failed. Users cannot tell which configuration is wrong.'),
    vscode.LanguageModelChatMessage.Assistant('The following error message appears, but it doesn\'t indicate that the terminal launch attempt from the `tasks.json` file has failed. As a result, users are unable to identify which configuration is incorrect.'),
    vscode.LanguageModelChatMessage.User(BASE_PROMPT + '\n' + 'Users are unable to identify that the terminal launch attempt from the `tasks.json` file has failed.'),
    vscode.LanguageModelChatMessage.Assistant('Users cannot recognize that the terminal launch attempt from the `tasks.json` file has failed.'),
    vscode.LanguageModelChatMessage.User(BASE_PROMPT + '\n' + 'The position of the IME widget is not good at the last of a long line.'),
    vscode.LanguageModelChatMessage.Assistant('The position of the IME widget is not ideal at the end of a long line.'),
    vscode.LanguageModelChatMessage.User(BASE_PROMPT + '\n' + 'We provide additional features by setting up new event listeners in `latextoybox.ts` for DOM elements within `viewer.html`. We do not and should not override functions defined by PDF.js.'),
    vscode.LanguageModelChatMessage.Assistant('To enhance functionality, we add new event listeners in `latextoybox.ts` for DOM elements within `viewer.html`. We neither override nor should we override functions defined by PDF.js.')
]

interface ChatHistoryEntry {
    user: string,
    assistant: string
}

type ChatHistory = ChatHistoryEntry[]

export const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
) => {
    if (request.command === 'fluent') {
        if (fluentMessages.length > 20) {
            fluentMessages = fluentMessages.slice(fluentMessages.length - 20)

        }
        const fluentHistory: ChatHistory = []
        for (const hist of context.history) {
            if (hist.participant === 'able.chatParticipant' && hist.command === 'fluent') {
                if (hist instanceof vscode.ChatResponseTurn) {
                    for (const res of hist.response) {
                        if (res instanceof vscode.ChatResponseMarkdownPart) {
                            const pair = extractInputAndOutput(res.value.value)
                            if (pair) {
                                const user = make_fluent_prompt(pair.input)
                                const assistant = pair.output
                                fluentHistory.push({user, assistant})
                            }
                        }
                    }
                }
            }
        }
        let prompt = '';
        let selectedText = ''
        for (const ref of request.references) {
            if (ref.id === 'vscode.implicit.selection') {
                const { uri, range } = ref.value as { uri: vscode.Uri, range: vscode.Range }
                const doc = await vscode.workspace.openTextDocument(uri)
                selectedText = doc.getText(range)
                prompt = make_fluent_prompt(selectedText)
                break
            }
        }
        fluentMessages.push(vscode.LanguageModelChatMessage.User(prompt))
        const chatResponse = await request.model.sendRequest(fluentMessages, {}, token)

        let responseText = ''
        for await (const fragment of chatResponse.text) {
            responseText += fragment
        }
        fluentMessages.push(vscode.LanguageModelChatMessage.Assistant(responseText))
        stream.markdown('#### input\n' + selectedText + '\n\n')
        stream.markdown('#### output\n' + responseText)
        return
    } else {
        stream.markdown('Unknown command')
    }
}

function extractInputAndOutput(str: string) {
    const regex = /#### input\n(.+?)\n\n#### output\n(.+)/s;
    const match = str.match(regex);
    if (match) {
        const input = match[1];
        const output = match[2];
        return {input, output}
    } else {
        return
    }
}
