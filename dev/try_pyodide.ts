import { loadPyodide } from '#pyodide'

async function helloPython() {
  const pyodide = await loadPyodide()
  console.log(pyodide)
  const result = await pyodide.runPythonAsync('1+1') as number
  console.log('Python says that 1+1 =', result)
}

void helloPython()
