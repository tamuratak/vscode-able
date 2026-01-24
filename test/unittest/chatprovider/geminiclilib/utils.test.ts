import { deepStrictEqual } from 'node:assert'
import { extractAttachments, tweakUserPrompt } from '../../../../src/chatprovider/geminiclilib/utils'

suite('tweakUserPrompt', () => {
	test('extracts each attachment and its attributes', () => {
		const input = `<user>
please review the attached files
<attachments>
<attachment id="spec" filePath="/docs/spec.md">
  specification content  
</attachment>
<attachment id="log" filePath="/logs/error.log">
error log line 1\nerror log line 2
</attachment>
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

suite('extractAttachments', () => {
	test('returns trimmed prompt and attachments for a block', () => {
		const input = `<user>
please review the attached files
<attachments>
<attachment id="spec" filePath="/docs/spec.md">
  specification content  
</attachment>
<attachment id="log" filePath="/logs/error.log">
error log line 1\nerror log line 2
</attachment>
</attachments>
</user>`
		const actual = extractAttachments(input)
		const expected = {
			newInput: '<user>\nplease review the attached files\n\n</user>',
			attachments: [
				{ content: 'specification content', id: 'spec', filePath: '/docs/spec.md', isSummarized: undefined },
				{ content: 'error log line 1\nerror log line 2', id: 'log', filePath: '/logs/error.log', isSummarized: undefined }
			]
		}
		deepStrictEqual(actual, expected)
	})

	test('strips tags when no attachments exist', () => {
		const input = `<user>
		just a plain prompt
		</user>`
		deepStrictEqual(extractAttachments(input), { newInput: '<user>\n\t\tjust a plain prompt\n\t\t</user>', attachments: [] })
	})
})
