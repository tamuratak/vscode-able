import { deepStrictEqual } from 'node:assert'
import { tweakUserPrompt } from '../../../../src/chatprovider/geminiclilib/utils'

suite('tweakUserPrompt', () => {
	test('extracts each attachment and its attributes', () => {
		const input = `<user>
please review the attached files
<attachments>
<attachment id="spec" filePath="/docs/spec.md">  specification content  </attachment>
<attachment id="log" filePath="/logs/error.log">error log line 1\nerror log line 2</attachment>
</attachments>
</user>`
		const actual = tweakUserPrompt(input)
		const expected = {
			userPrompt: 'please review the attached files',
			attachments: [
				{ content: 'specification content', id: 'spec', filePath: '/docs/spec.md', isSummarized: undefined },
				{ content: 'error log line 1\nerror log line 2', id: 'log', filePath: '/logs/error.log', isSummarized: undefined }
			]
		}
		deepStrictEqual(actual, expected)
	})

	test('returns cleaned prompt when no attachments block exists', () => {
		const input = `<user>
		just a plain prompt
		</user>`
		deepStrictEqual(tweakUserPrompt(input), { userPrompt: 'just a plain prompt', attachments: [] })
	})


})
