import * as vscode from 'vscode'

const BASE_PROMPT = 'No codeblocks. Make fluent:'

let fluentMessages = [
    vscode.LanguageModelChatMessage.User(BASE_PROMPT + '\n' + 'The following error message pops up. The message doesn\'t mention that  the terminal launch attempt from the `tasks.json` file has failed. Users cannot tell which configuration is wrong.'),
    vscode.LanguageModelChatMessage.Assistant('The following error message appears, but it doesn\'t indicate that the terminal launch attempt from the `tasks.json` file has failed. As a result, users are unable to identify which configuration is incorrect.'),
    vscode.LanguageModelChatMessage.User(BASE_PROMPT + '\n' + 'Users are unable to identify that the terminal launch attempt from the `tasks.json` file has failed.'),
    vscode.LanguageModelChatMessage.Assistant('Users cannot recognize that the terminal launch attempt from the `tasks.json` file has failed.'),
    vscode.LanguageModelChatMessage.User(BASE_PROMPT + '\n' + 'The position of the IME widget is not good at the last of a long line.'),
    vscode.LanguageModelChatMessage.Assistant('The position of the IME widget is not ideal at the end of a long line.'),
]

export const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
) => {
    if (request.command === 'fluent') {
        if (fluentMessages.length > 20) {
            fluentMessages = fluentMessages.slice(fluentMessages.length - 20)

        }
        let prompt = BASE_PROMPT;
        let selectedText = ''
        for (const ref of request.references) {
            if (ref.id === 'vscode.implicit.selection') {
                const { uri, range } = ref.value as { uri: vscode.Uri, range: vscode.Range }
                const doc = await vscode.workspace.openTextDocument(uri)
                selectedText = doc.getText(range)
                prompt += '\n' + selectedText
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
        stream.markdown('#### request\n' + selectedText + '\n\n')
        stream.markdown('#### fluent\n' + responseText)
        return
    } else {
        stream.markdown('Unknown command')
    }
}
