import { strictEqual } from 'node:assert'
import * as vscode from 'vscode'
import { isRetryableError } from '../../../src/chatprovider/opencodegochatprovider/retry.js'
import { ResponsesStreamError } from '../../../src/chatprovider/opencodegochatprovider/openai/openaiResponsesApi.js'

function makeToken(): vscode.CancellationToken {
    const cts = new vscode.CancellationTokenSource()
    return cts.token
}

function makeCancelledToken(): vscode.CancellationToken {
    const cts = new vscode.CancellationTokenSource()
    cts.cancel()
    return cts.token
}

suite('isRetryableError', () => {
    test('classifies retryable HTTP status codes as retryable', () => {
        for (const status of [408, 425, 429, 500, 502, 503, 504]) {
            const error = new Error(`API error: [${status}] Service Unavailable`)
            strictEqual(isRetryableError(error, false, makeToken()), true, `status ${status} should be retryable`)
        }
    })

    test('classifies client error status codes as non-retryable', () => {
        for (const status of [400, 401, 403, 404, 422]) {
            const error = new Error(`API error: [${status}] Bad Request`)
            strictEqual(isRetryableError(error, false, makeToken()), false, `status ${status} should not be retryable`)
        }
    })

    test('classifies transient stream termination messages as retryable', () => {
        for (const message of [
            'Stream ended with incomplete tool calls',
            'Tool call missing id',
            'fetch failed',
            'rate_limit_exceeded',
            'server_error',
        ]) {
            strictEqual(isRetryableError(new Error(message), false, makeToken()), true)
        }
    })

    test('classifies ResponsesStreamError as retryable', () => {
        const error = new ResponsesStreamError('Responses API stream timed out after 120000ms without data', 'inactivity_timeout')
        strictEqual(isRetryableError(error, false, makeToken()), true)
    })

    test('classifies AbortError as non-retryable', () => {
        const error = new Error('The user aborted a request.')
        error.name = 'AbortError'
        strictEqual(isRetryableError(error, false, makeToken()), false)
    })

    test('never retries when the user cancelled', () => {
        strictEqual(isRetryableError(new Error('fetch failed'), false, makeCancelledToken()), false)
        strictEqual(isRetryableError(new Error('API error: [503] Service Unavailable'), true, makeCancelledToken()), false)
    })

    test('classifies HTTP connect-phase timeouts as retryable', () => {
        strictEqual(isRetryableError(new Error('fetch failed'), true, makeToken()), true)
        strictEqual(isRetryableError(undefined, true, makeToken()), true)
    })

    test('classifies unknown errors as non-retryable', () => {
        strictEqual(isRetryableError(new Error('Some other error'), false, makeToken()), false)
        strictEqual(isRetryableError(undefined, false, makeToken()), false)
        strictEqual(isRetryableError(null, false, makeToken()), false)
    })
})
