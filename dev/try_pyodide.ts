import { loadPyodide } from 'pyodide'
import type { FS } from 'emscripten'
async function helloPython() {
  const pyodide = await loadPyodide()
  const fs = pyodide.FS as FS
  console.log(fs)
  if (fs.filesystems.NODEFS) {
    fs.mkdirTree('/pyodide')
    fs.mount(fs.filesystems.NODEFS, { root: '.' }, '/pyodide')
    pyodide.runPython("import os; print(os.listdir('/pyodide'))")
  }
  const result = await pyodide.runPythonAsync('1+1') as number
  console.log('Python says that 1+1 =', result)
}

void helloPython()

