// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { downloadContents, downloadFile, extractFile, extractTarBz2, PYODIDE_KERNEL_VERSION, PYODIDE_VERSION } from './common.js';


const pydodideKernelApiUrl = `https://api.github.com/repos/jupyterlite/pyodide-kernel/releases/tags/v${PYODIDE_KERNEL_VERSION}`;

const pyodideApiUri = `https://api.github.com/repos/pyodide/pyodide/releases/tags/${PYODIDE_VERSION}`;
const packagesToKeep = ['attrs-', 'decorator', 'distutils', 'fonttools', 'hashlib',
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

type ReleaseInfo = {
    assets: {
        url: string;
        browser_download_url: string;
        name: string;
        content_type: string;
        size: number;
    }[];
};

export async function downloadPyodideKernel() {
    const contents = await downloadContents(pydodideKernelApiUrl);
    const json: ReleaseInfo = JSON.parse(contents);
    const fileToDownload = json.assets.find((asset) =>
        asset.name.toLowerCase() === `jupyterlite-pyodide-kernel-${PYODIDE_KERNEL_VERSION}.tgz`
    )!;
    console.debug(`Download ${fileToDownload.name} (${fileToDownload.url})`);
    const tarFile = path.join(tmpdir(), fileToDownload.name);
    if (fs.existsSync(tarFile)) {
        fs.rmSync(tarFile);
    }
    await downloadFile(fileToDownload.url, tarFile);
    console.debug(`Downloaded to ${tarFile}`);
    const dir = path.join(__dirname, '..', 'pyodide');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
    await extractFile(tarFile, dir);
    await deleteUnwantedFilesFromPyodideKernel(dir);
    console.debug(`Extracted to ${dir}`);
}


async function deleteUnwantedFilesFromPyodideKernel(dir: string) {
    const files = [
        path.join(dir, 'lib'),
        path.join(dir, 'style'),
        path.join(dir, 'package.json'),
        path.join(dir, 'tsconfig.tsbuildinfo')
    ];
    files.forEach((file) => {
        if (fs.existsSync(file)) {
            fs.rmSync(file, { recursive: true });
        }
    });
    const pypiFiles = fs.readdirSync(path.join(dir, 'pypi'));
    pypiFiles
        .filter((file) => file.toLowerCase().startsWith('widgetsnbextension'))
        .forEach((file) => fs.rmSync(path.join(dir, 'pypi', file), { recursive: true }));
}


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


export async function downloadPyodideArtifacts() {
    const contents = await downloadContents(pyodideApiUri);
    const json: ReleaseInfo = JSON.parse(contents);
    const fileToDownload = json.assets.find((asset) =>
        asset.name.toLowerCase() === `pyodide-${PYODIDE_VERSION}.tar.bz2`
    )!;
    console.debug(`Downloading ${fileToDownload.name} (${fileToDownload.url})`);
    const tarFile = path.join(__dirname, '..', 'temp', fileToDownload.name);
    if (!fs.existsSync(path.dirname(tarFile))) {
        fs.mkdirSync(path.dirname(tarFile), { recursive: true });
    }
    await downloadFile(fileToDownload.url, tarFile);
    console.debug(`Downloaded to ${tarFile}`);
    const dir = path.join(__dirname, '..', 'temp');
    console.debug(`Extracting into ${dir}`);
    // Extraction is slow, use the previously extracted files if they exist.
    if (!fs.existsSync(path.join(dir, 'pyodide')) || !fs.readdirSync(path.join(dir, 'pyodide')).length) {
        await extractTarBz2(tarFile, dir);
    }

    // Extract only the files we need.
    fs.readdirSync(path.join(dir, 'pyodide')).forEach(file => {
        const dest = path.join(__dirname, '..', 'pyodide', file);
        const source = path.join(dir, 'pyodide', file);
        if (file.toLowerCase().endsWith('-tests.tar')) {
            return;
        }
        if (fs.existsSync(dest)) {
            fs.rmSync(dest, { recursive: true });
        }
        if (!fs.existsSync(path.dirname(dest))) {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
        }

        if (packagesToKeep.some(keep => file.toLowerCase().startsWith(keep.toLowerCase()))) {
            if (fs.statSync(source).isDirectory()) {
                fs.cpSync(source, dest, { recursive: true });
            } else {
                fs.copyFileSync(source, dest);
            }
        }
    });
    console.debug(`Extracted to ${dir}`);
}

async function main() {
    const pyodideDir = path.join(__dirname, '..', 'pyodide');
    if (fs.existsSync(pyodideDir)) {
        fs.rmSync(pyodideDir, { recursive: true });
    }
    await downloadPyodideKernel();
    await downloadCommWheel();
    await downloadSeabornWheels();
    // renameLicense();
}

main();
