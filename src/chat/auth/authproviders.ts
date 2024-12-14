/**
MIT License

Copyright (c) 2015 - present Microsoft Corporation

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
*/

import OpenAI from 'openai'
import {
	authentication,
	AuthenticationProvider,
	AuthenticationProviderAuthenticationSessionsChangeEvent,
	AuthenticationSession,
	Disposable,
	Event,
	EventEmitter,
	SecretStorage,
	window,
} from 'vscode'


abstract class BaseApiKeyAuthenticationProvider implements AuthenticationProvider, Disposable {
	abstract readonly label: string
	abstract readonly serviceId: string
	protected abstract readonly secretStoreKey: string

	protected abstract validateKey(key: string): Promise<boolean>

	// this property is used to determine if the token has been changed in another window of VS Code.
	// It is used in the checkForUpdates function.
	private currentApiKey: Thenable<string | undefined> | undefined
	private initializedDisposable: Disposable | undefined

	private readonly _onDidChangeSessions = new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>()

	get onDidChangeSessions(): Event<AuthenticationProviderAuthenticationSessionsChangeEvent> {
		return this._onDidChangeSessions.event
	}

	constructor(private readonly secretStorage: SecretStorage) { }

	dispose(): void {
		this.initializedDisposable?.dispose()
	}

	private ensureInitialized(): void {
		if (this.initializedDisposable === undefined) {
			void this.cacheApiKeyFromStorage()

			this.initializedDisposable = Disposable.from(
				// This onDidChange event happens when the secret storage changes in _any window_ since
				// secrets are shared across all open windows.
				this.secretStorage.onDidChange(e => {
					if (e.key === this.secretStoreKey) {
						void this.checkForUpdates()
					}
				}),
				// This fires when the user initiates a "silent" auth flow via the Accounts menu.
				authentication.onDidChangeSessions(e => {
					if (e.provider.id === this.serviceId) {
						void this.checkForUpdates()
					}
				}),
			)
		}
	}

	// This is a crucial function that handles whether or not the token has changed in
	// a different window of VS Code and sends the necessary event if it has.
	private async checkForUpdates(): Promise<void> {
		const added: AuthenticationSession[] = []
		const removed: AuthenticationSession[] = []
		const changed: AuthenticationSession[] = []

		const previousApiKey = await this.currentApiKey
		const session = (await this.getSessions())[0]

		if (session?.accessToken && !previousApiKey) {
			added.push(session)
		} else if (!session?.accessToken && previousApiKey) {
			removed.push(session)
		} else if (session?.accessToken !== previousApiKey) {
			changed.push(session)
		} else {
			return
		}

		void this.cacheApiKeyFromStorage()
		this._onDidChangeSessions.fire({ added, removed, changed })
	}

	private cacheApiKeyFromStorage() {
		this.currentApiKey = this.secretStorage.get(this.secretStoreKey)
		return this.currentApiKey
	}

	// This function is called first when `vscode.authentication.getSessions` is called.
	async getSessions(_scopes?: string[]): Promise<AuthenticationSession[]> {
		this.ensureInitialized()
		const apiKey = await this.cacheApiKeyFromStorage()
		return apiKey ? [this.toAuthenticationSession(apiKey)] : []
	}

	// This function is called after `this.getSessions` is called and only when:
	// - `this.getSessions` returns nothing but `createIfNone` was set to `true` in `vscode.authentication.getSessions`
	// - `vscode.authentication.getSessions` was called with `forceNewSession: true`
	// - The end user initiates the "silent" auth flow via the Accounts menu
	async createSession(_scopes: string[]): Promise<AuthenticationSession> {
		const disposables: Disposable[] = []
		this.ensureInitialized()

		const input = window.createInputBox();
		input.title = this.label
		input.password = true;
		input.placeholder = 'API Key'
		input.prompt = 'Enter an API Key.'
		input.ignoreFocusOut = true
		input.onDidChangeValue(() => {
			input.validationMessage = undefined
		}, disposables)
		input.show()

		let apiKey: string
		try {
			apiKey = await new Promise((resolve, reject) => {
				const errorMessage = 'Invalid API key'
				input.onDidAccept(async () => {
					input.busy = true;
					input.enabled = false;
					if (!input.value || !(await this.validateKey(input.value))) {
						input.validationMessage = errorMessage
						input.busy = false
						input.enabled = true
						return
					}
					resolve(input.value)
				}, disposables)
				input.onDidHide(async () => {
					if (!input.value || !(await this.validateKey(input.value))) {
						reject(new Error(errorMessage))
					}
				}, disposables)
			})
		} finally {
			disposables.forEach(d => {
				d.dispose()
			})
		}

		// Don't set `currentApiKey` here, since we want to fire the proper events in the `checkForUpdates` call
		await this.secretStorage.store(this.secretStoreKey, apiKey)
		console.log('Successfully logged in.')

		return this.toAuthenticationSession(apiKey)
	}

	// This function is called when the end user signs out of the account.
	async removeSession(_sessionId: string): Promise<void> {
		const apiKey = await this.currentApiKey
		if (!apiKey) {
			return
		}
		await this.secretStorage.delete(this.secretStoreKey)
		this._onDidChangeSessions.fire({ removed: [this.toAuthenticationSession(apiKey)], added: [], changed: [] })
	}

	private toAuthenticationSession(apiKey: string): AuthenticationSession {
		return {
			accessToken: apiKey,
			id: this.serviceId,
			account: {
				label: this.label,
				id: this.serviceId,
			},
			scopes: [],
		}
	}

}

export class OpenAiApiKeyAuthenticationProvider extends BaseApiKeyAuthenticationProvider {
	readonly label = 'OpenAI API (with Able)'
	readonly serviceId = 'openai_api'
	protected readonly secretStoreKey = 'openai_api.secret_store_key'

	protected async validateKey(apiKey: string): Promise<boolean> {
		try {
			const client = new OpenAI({ apiKey })
			const result = await client.models.list()
			if (result.data.length > 0) {
				return true
			} else {
				return false
			}
		} catch {
			return false
		}
	}

}
