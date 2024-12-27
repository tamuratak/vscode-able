// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { downloadFile } from './common.js';

export const packagesToKeep = ['attrs-', 'decorator', 'distutils', 'fonttools', 'hashlib',
    'matplotlib', 'micropip', 'numpy', 'mpmpath', 'openssl', 'package.json', 'pandas',
    'pydecimal', 'pyodide', 'python_date', 'python_std', 'pytz', 'six', 'sqlite', 'ssl',
    // These are definitely required to get things running.
    'pydoc_data', 'lzma-', 'distutils', 'ffi.d.ts', 'packaging-', 'traitlets-', 'ipython-',
    // These are definitely required to get simple execution like `what is the current time`
    'asttokens', 'executing', 'prompt_toolkit', 'pure_eval', 'pygments', 'stack_data', 'wcwidth',
    // These are definitely required to get simple execution like plot a matplot lib graph
    'cycler', 'kiwisolver', 'pyparsing',
    // Do not distribute these due to licensing issues.
    // 'pillow'
]

export async function downloadCommWheel() {
    const url = 'https://files.pythonhosted.org/packages/e6/75/49e5bfe642f71f272236b5b2d2691cf915a7283cc0ceda56357b61daa538/comm-0.2.2-py3-none-any.whl';
    const dest = path.join(__dirname, '..', 'pyodide', 'comm-0.2.2-py3-none-any.whl');
    if (fs.existsSync(dest)) {
        // Re-use the same file.
        return;
    }
    await downloadFile(url, dest);
}

export async function downloadSeabornWheels() {
    const url = 'https://files.pythonhosted.org/packages/83/11/00d3c3dfc25ad54e731d91449895a79e4bf2384dc3ac01809010ba88f6d5/seaborn-0.13.2-py3-none-any.whl';
    const dest = path.join(__dirname, '..', 'pyodide', 'seaborn-0.13.2-py3-none-any.whl');
    if (fs.existsSync(dest)) {
        // Re-use the same file.
        return;
    }
    await downloadFile(url, dest);
}

async function main() {
    const pyodideDir = path.join(__dirname, '..', 'pyodide');
    if (fs.existsSync(pyodideDir)) {
        fs.rmSync(pyodideDir, { recursive: true });
    }
    await downloadCommWheel();
    await downloadSeabornWheels();
    // renameLicense();
}

main();
