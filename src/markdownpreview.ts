import * as vscode from 'vscode'
import markdownIt from 'markdown-it'
import markdownItKatex from '@vscode/markdown-it-katex'
import { debugObj } from './utils/debug.js'

export const markdownPreviewPanelViewType = 'able-markdownpreview'
// let restored = false

interface UpdateEvent {
    type: 'selection',
    event: vscode.TextEditorSelectionChangeEvent
}

function resourcesFolder(extensionUri: vscode.Uri) {
    return vscode.Uri.joinPath(
        extensionUri,
        'node_modules',
        '@vscode',
        'markdown-it-katex',
        'node_modules',
        'katex',
        'dist'
    )
}

export class MarkdownPreviewPanel {
    private panel: vscode.WebviewPanel | undefined
    prevDocumentUri: string | undefined
    prevCursorPosition: vscode.Position | undefined
    private readonly mdIt = markdownIt().use(markdownItKatex)
    constructor(readonly extension: {
        readonly extensionUri: vscode.Uri
        readonly outputChannel: vscode.LogOutputChannel
    }) { }

    private renderMarkdown(input: string): string {
        try {
            return this.mdIt.render(input)
        } catch (err) {
            debugObj('Error rendering markdown', err, this.extension.outputChannel)
            throw err
        }
    }

    private findPanelTabs() {
        return vscode.window.tabGroups.all.flatMap(group =>
            group.tabs.filter(tab => {
                return tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes(markdownPreviewPanelViewType)
            })
        )
    }

    // When the extension host reloads due to an extension update or other reasons,
    // the connection with the webview is lost. Therefore, we close the old panel
    // and open a new panel.
    async reopenPanelOnNewSession() {
//        if (restored || this.panel) {
//            return
//        }
        const oldPanelTab = this.findPanelTabs()[0]
        if (oldPanelTab) {
            this.open(oldPanelTab.group.viewColumn)
            // We need to locate the old tab again because the oldPanelTab object becomes invalid after a tab operation.
            const theOldPanelTab = this.findPanelTabs()[0]
            if (theOldPanelTab) {
                await vscode.window.tabGroups.close(theOldPanelTab)
            }
        }
    }

    open(viewColumn?: vscode.ViewColumn) {
        const activeDocument = vscode.window.activeTextEditor?.document
        if (this.panel) {
            if (!this.panel.visible) {
                this.panel.reveal(undefined, true)
            }
            return
        }
        const panel = vscode.window.createWebviewPanel(
            markdownPreviewPanelViewType,
            'Markdown Comment Preview',
            { viewColumn: viewColumn || vscode.ViewColumn.Active, preserveFocus: true },
            {
                enableScripts: true,
                localResourceRoots: [resourcesFolder(this.extension.extensionUri)],
                retainContextWhenHidden: true
            }
        )
        this.initializePanel(panel)
        panel.webview.html = this.getHtml(panel.webview)
        if (activeDocument && !viewColumn) {
            panel.reveal(viewColumn, false)
        }
    }

    initializePanel(panel: vscode.WebviewPanel) {
        let timeout: NodeJS.Timeout | undefined
        const disposable = vscode.Disposable.from(
            vscode.workspace.onDidChangeTextDocument(() => {
                if (timeout) {
                    clearTimeout(timeout)
                    timeout = undefined
                }
                timeout = setTimeout(() => {
                    void this.update()
                }, 200)

            }),
            vscode.window.onDidChangeTextEditorSelection((event) => {
                if (timeout) {
                    clearTimeout(timeout)
                    timeout = undefined
                }
                void this.update({ type: 'selection', event })
            })
        )
        this.panel = panel
        panel.onDidDispose(() => {
            disposable.dispose()
            this.clearCache()
            this.panel = undefined
        })
        panel.onDidChangeViewState((ev) => {
            if (ev.webviewPanel.visible) {
                void this.update()
            }
        })
        panel.webview.onDidReceiveMessage(() => {
            void this.update()
        })
    }

    close() {
        this.panel?.dispose()
        this.panel = undefined
        this.clearCache()
    }

    toggle() {
        if (this.panel) {
            this.close()
        } else {
            void this.open()
        }
    }

    private clearCache() {
        this.prevDocumentUri = undefined
        this.prevCursorPosition = undefined
    }

    getHtml(webview: vscode.Webview, htmlString = ''): string {
        const cssPath = vscode.Uri.joinPath(resourcesFolder(this.extension.extensionUri), './katex.css')
        const cssPathSrc = webview.asWebviewUri(cssPath)
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; script-src ${webview.cspSource}; img-src data:; style-src 'unsafe-inline';">
            <meta charset="UTF-8">
            <style>
                body {
                    padding: 0;
                    margin: 0;
                }
                #math {
                    padding-top: 35px;
                    padding-left: 50px;
                }
            </style>
            <link rel="stylesheet" href="${cssPathSrc}" defer>
        </head>
        <body>
            ${htmlString}
        </body>
        </html>`
    }

    update(ev?: UpdateEvent) {
        if (!this.panel || !this.panel.visible) {
            return
        }
        const editor = vscode.window.activeTextEditor
        const document = editor?.document
        if (!editor || !document?.languageId) {
            this.clearCache()
            return
        }
        const documentUri = document.uri.toString()
        const cursorPos = ev?.event.selections[0]?.active ?? editor.selection.active
        const mdRange = this.getMarkdownRange(document, cursorPos)
        if (!mdRange) {
            this.clearCache()
            return
        }
        if (this.prevDocumentUri === documentUri && this.prevCursorPosition?.isEqual(cursorPos)) {
            return
        }
        const mdText = document.getText(mdRange)
        try {
            const htmlString = this.renderMarkdown(mdText)
            const fullHtml = this.getHtml(this.panel.webview, htmlString)
            this.panel.webview.html = fullHtml
        } catch (err) {
            debugObj('Error updating markdown preview', err, this.extension.outputChannel)
            throw err
        }
        this.prevDocumentUri = documentUri
        this.prevCursorPosition = cursorPos
    }

    private getMarkdownRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range | undefined {
        const beginRegex = /^\s*\/--/
        const endRegex = /-\/\s*$/
        const maxScanLines = 100
        let beginLine: number | undefined
        let endLine: number | undefined
        for (let i = 0; i < maxScanLines; i++) {
            const lineAbove = position.line - i
            if (lineAbove < 0) {
                break
            }
            const text = document.lineAt(lineAbove).text
            if (beginRegex.test(text)) {
                beginLine = lineAbove
                break
            }
        }
        for (let i = 0; i < maxScanLines; i++) {
            const lineBelow = position.line + i
            if (lineBelow >= document.lineCount) {
                break
            }
            const text = document.lineAt(lineBelow).text
            if (endRegex.test(text)) {
                endLine = lineBelow
                break
            }
        }
        if (beginLine !== undefined && endLine !== undefined && endLine > beginLine) {
            return new vscode.Range(new vscode.Position(beginLine + 1, 0), new vscode.Position(endLine, 0))
        }
        return undefined
    }
}
