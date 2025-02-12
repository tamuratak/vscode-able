import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Writable } from "node:stream";

// Check for ./pyodide directory, create if it doesn't exist
const pyodideDir = path.resolve('./pyodide');
if (!fs.existsSync(pyodideDir)) {
  fs.mkdirSync(pyodideDir, { recursive: true });
  console.log('Created directory:', pyodideDir);
} else {
  console.log('Directory exists:', pyodideDir);
  process.exit(0);
}

// Download and extraction parameters
const url = 'https://github.com/pyodide/pyodide/releases/download/0.26.4/pyodide-0.26.4.tar.bz2';
const tarballPath = path.join(pyodideDir, 'pyodide-0.26.4.tar.bz2');

// Updated downloadFile using fetch and async/await
async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed with status ${res.status}`);
  }
  const fileStream = fs.createWriteStream(dest);
  const fstream = Writable.toWeb(fileStream);
  return res.body.pipeTo(fstream)
}

async function run() {
  try {
    console.log('Downloading Pyodide tarball...');
    await downloadFile(url, tarballPath);
    console.log('Download complete.');
    console.log('Extracting tarball...');
    // Executes: tar -vxjf pyodide-0.26.4.tar.bz2 -C ./pyodide
    spawnSync('tar', ['-vxjf', tarballPath, '-C', pyodideDir], { stdio: 'inherit' });
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}
run();
