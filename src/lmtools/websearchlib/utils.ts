export async function resolveRedirectUri(uriString: string): Promise<string | undefined> {
	const response = await fetch(uriString, { method: 'HEAD', redirect: 'follow' })
	if (response.redirected) {
		return response.url
	}
	return undefined
}
