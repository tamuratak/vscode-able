/*

MIT License

Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

https://github.com/microsoft/vscode-copilot-chat/blob/main/src/extension/prompts/node/base/tag.tsx

*/

import { PromptElement, PromptElementProps, PromptPiece, TextChunk, useKeepWith } from '@vscode/prompt-tsx'

export type TagProps = PromptElementProps<{
	name: string
	attrs?: Record<string, string | undefined | boolean | number>
}>

export class Tag extends PromptElement<TagProps> {

	private static readonly _regex = /^[a-zA-Z_][\w.-]*$/

	render(): PromptPiece | undefined {

		const { name, children, attrs = {} } = this.props

		if (!Tag._regex.test(name)) {
			throw new Error(`Invalid tag name: ${this.props.name}`)
		}

		let attrStr = ''
		for (const [key, value] of Object.entries(attrs)) {
			if (value !== undefined) {
				attrStr += ` ${key}=${JSON.stringify(value)}`
			}
		}

		if (children?.length === 0) {
			if (!attrStr) {
				return
			}

			return <TextChunk>{`<${name}${attrStr} />`}</TextChunk>
		}

		const KeepWith = useKeepWith()

		return (
			<>
				<KeepWith>{`<${name}${attrStr}>\n`}</KeepWith>
				<TagInner priority={1} flexGrow={1}>{children}<br /></TagInner>
				<KeepWith>{`</${name}>`}</KeepWith>
				<br />
			</>
		)
	}
}

class TagInner extends PromptElement {
	render() {
		return <>{this.props.children}</>
	}
}
