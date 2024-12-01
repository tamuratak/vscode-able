import * as vscode from 'vscode'

const BASE_PROMPT = 'No codeblocks. Make fluent:'

const modelPromise = vscode.lm.selectChatModels()

export const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
) => {
    const _model = await modelPromise;
    console.log('model', _model)
    let prompt = BASE_PROMPT;
    for (const ref of request.references) {
        if (ref.id === 'vscode.implicit.selection') {
            const { uri, range } = ref.value as { uri: vscode.Uri, range: vscode.Range }
            const doc = await vscode.workspace.openTextDocument(uri)
            const text = doc.getText(range)
            prompt += '\n' + text
            break
        }
    }
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    /*
        const previousMessages: vscode.LanguageModelChatMessage[] = []
        for (const hist of context.history) {
            if (hist instanceof vscode.ChatResponseTurn) {
                hist.
                hist.response.forEach((res) => {
                    if (res instanceof vscode.ChatResponseMarkdownPart) {
                        previousMessages.push(vscode.LanguageModelChatMessage.Assistant(res.value.value))
                    }
                })
            } else if (hist instanceof vscode.ChatRequestTurn) {
                hist.
                    if (req instanceof vscode.ChatRequestMessage) {
                        previousMessages.push(vscode.LanguageModelChatMessage.User(req.value))
                    }
                })
            }
        }
    */

    const chatResponse = await request.model.sendRequest(messages, {}, token);

    // stream the response
    for await (const fragment of chatResponse.text) {
        stream.markdown(fragment);
    }

    return;

}
