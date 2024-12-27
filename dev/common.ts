// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { https } from 'follow-redirects';
import { parse } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const PYTHON_VERSION = '3.12.1'; // Version of Python used in Pyodide, check https://github.com/pyodide/pyodide/blob/main/Makefile.envs
export const PYTHON_VERSION_SHORT = '3.12'; // Version of Python used in Pyodide, check https://github.com/pyodide/pyodide/blob/main/Makefile.envs
export const PYODIDE_VERSION = '0.27.0a2';
export const PYODIDE_KERNEL_VERSION = '0.4.3';

export function getRequestOptions(url: string) {
	const token = process.env['GITHUB_TOKEN'];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const downloadOpts: Record<string, any> = {
		headers: {
			'user-agent': 'vscode-pyodide'
		},
		// ...new URL(url)
		...parse(url)
	};

	if (token) {
		downloadOpts['headers'].authorization = `token ${token}`;
	}

	return downloadOpts;
}

export function downloadFile(url: string, dest: string) {
	if (fs.existsSync(dest)) {
		// Re-use the same file.
		return;
	}
	if (!fs.existsSync(path.dirname(dest))) {
		fs.mkdirSync(path.dirname(dest), { recursive: true });
	}
	const downloadOpts = getRequestOptions(url);
	downloadOpts['headers'].accept = 'application/octet-stream';
	return new Promise<void>((resolve, reject) => {
		const file = fs.createWriteStream(dest);
		https
			.get(downloadOpts, (response) => {
				if (response.statusCode !== 200) {
					return reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
				}

				let receivedBytes = 0;
				response.on('data', function (chunk) {
					receivedBytes += chunk.length;
				});
				response.pipe(file);

				file.on('finish', () => {
					file.close(() => resolve());
				});
			})
			.on('error', (err) => reject(err));
	});
}
