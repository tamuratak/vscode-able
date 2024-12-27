```
$  ls out/pyodide  
LICENSE                                                          pure_eval-0.2.2-py3-none-any.whl.metadata
asttokens-2.4.1-py2.py3-none-any.whl                             pydecimal-1.0.0-py2.py3-none-any.whl
asttokens-2.4.1-py2.py3-none-any.whl.metadata                    pydecimal-1.0.0-py2.py3-none-any.whl.metadata
attrs-23.2.0-py3-none-any.whl                                    pydoc_data-1.0.0-py2.py3-none-any.whl
attrs-23.2.0-py3-none-any.whl.metadata                           pydoc_data-1.0.0-py2.py3-none-any.whl.metadata
comm-0.2.2-py3-none-any.whl                                      pygments-2.17.2-py3-none-any.whl
cycler-0.12.1-py3-none-any.whl                                   pygments-2.17.2-py3-none-any.whl.metadata
cycler-0.12.1-py3-none-any.whl.metadata                          pyodide-lock.json
decorator-5.1.1-py3-none-any.whl                                 pyodide.asm.js
decorator-5.1.1-py3-none-any.whl.metadata                        pyodide.asm.wasm*
executing-2.0.1-py2.py3-none-any.whl                             pyodide.d.ts
executing-2.0.1-py2.py3-none-any.whl.metadata                    pyodide.js
ffi.d.ts                                                         pyodide.js.map
fonttools-4.51.0-py3-none-any.whl                                pyodide.mjs
fonttools-4.51.0-py3-none-any.whl.metadata                       pyodide.mjs.map
hashlib-1.0.0-py2.py3-none-any.whl                               pyodide_http-0.2.1-py3-none-any.whl
hashlib-1.0.0-py2.py3-none-any.whl.metadata                      pyodide_http-0.2.1-py3-none-any.whl.metadata
ipython-8.23.0-py3-none-any.whl                                  pyodide_unix_timezones-1.0.0-py3-none-any.whl
ipython-8.23.0-py3-none-any.whl.metadata                         pyodide_unix_timezones-1.0.0-py3-none-any.whl.metadata
kiwisolver-1.4.5-cp312-cp312-pyodide_2024_0_wasm32.whl           pyparsing-3.1.2-py3-none-any.whl
kiwisolver-1.4.5-cp312-cp312-pyodide_2024_0_wasm32.whl.metadata  pyparsing-3.1.2-py3-none-any.whl.metadata
lzma-1.0.0-py2.py3-none-any.whl                                  pypi/
lzma-1.0.0-py2.py3-none-any.whl.metadata                         python_dateutil-2.9.0.post0-py2.py3-none-any.whl
matplotlib-3.5.2-cp312-cp312-pyodide_2024_0_wasm32.whl           python_dateutil-2.9.0.post0-py2.py3-none-any.whl.metadata
matplotlib-3.5.2-cp312-cp312-pyodide_2024_0_wasm32.whl.metadata  python_stdlib.zip
matplotlib_inline-0.1.7-py3-none-any.whl                         pytz-2024.1-py2.py3-none-any.whl
matplotlib_inline-0.1.7-py3-none-any.whl.metadata                pytz-2024.1-py2.py3-none-any.whl.metadata
matplotlib_pyodide-0.2.2-py3-none-any.whl                        schema/
matplotlib_pyodide-0.2.2-py3-none-any.whl.metadata               seaborn-0.13.2-py3-none-any.whl
micropip-0.6.0-py3-none-any.whl                                  six-1.16.0-py2.py3-none-any.whl
micropip-0.6.0-py3-none-any.whl.metadata                         six-1.16.0-py2.py3-none-any.whl.metadata
numpy-1.26.4-cp312-cp312-pyodide_2024_0_wasm32.whl               sqlite3-1.0.0-py2.py3-none-any.whl
numpy-1.26.4-cp312-cp312-pyodide_2024_0_wasm32.whl.metadata      sqlite3-1.0.0-py2.py3-none-any.whl.metadata
openssl-1.1.1w.zip                                               ssl-1.0.0-py2.py3-none-any.whl
package.json                                                     ssl-1.0.0-py2.py3-none-any.whl.metadata
packaging-23.2-py3-none-any.whl                                  stack_data-0.6.3-py3-none-any.whl
packaging-23.2-py3-none-any.whl.metadata                         stack_data-0.6.3-py3-none-any.whl.metadata
pandas-2.2.2-cp312-cp312-pyodide_2024_0_wasm32.whl               traitlets-5.14.3-py3-none-any.whl
pandas-2.2.2-cp312-cp312-pyodide_2024_0_wasm32.whl.metadata      traitlets-5.14.3-py3-none-any.whl.metadata
prompt_toolkit-3.0.43-py3-none-any.whl                           wcwidth-0.2.13-py2.py3-none-any.whl
prompt_toolkit-3.0.43-py3-none-any.whl.metadata                  wcwidth-0.2.13-py2.py3-none-any.whl.metadata
pure_eval-0.2.2-py3-none-any.whl
```

```
$  ls out/pyodide/pypi                                     
all.json                               ipykernel-6.9.2-py3-none-any.whl       piplite-0.4.3-py3-none-any.whl         pyodide_kernel-0.4.3-py3-none-any.whl
```

```
$  ls out/pyodide/schema 
piplite.v0.schema.json
```

```json
$  cat out/pyodide/pypi/all.json 
{
  "ipykernel": {
    "releases": {
      "6.9.2": [
        {
          "comment_text": "",
          "digests": {
            "md5": "337bacb9ba17ddc4238374ab85cf3313",
            "sha256": "37e3953a20ed558fae3951c8db3acd626de454b0629ae451317182ec8c62a7b8"
          },
          "downloads": -1,
          "filename": "ipykernel-6.9.2-py3-none-any.whl",
          "has_sig": false,
          "md5_digest": "337bacb9ba17ddc4238374ab85cf3313",
          "packagetype": "bdist_wheel",
          "python_version": "py3",
          "requires_python": ">=3.10",
          "size": 2731,
          "upload_time": "2024-10-21T12:42:50.413450Z",
          "upload_time_iso_8601": "2024-10-21T12:42:50.413450Z",
          "url": "./ipykernel-6.9.2-py3-none-any.whl",
          "yanked": false,
          "yanked_reason": null
        }
      ]
    }
  },
  "piplite": {
    "releases": {
      "0.4.3": [
        {
          "comment_text": "",
          "digests": {
            "md5": "0147712b461d1ed259754813d7d0d8be",
            "sha256": "564c30e8b6fe1e5f8077a3b0aadb8f782f57de4395c1bc65b0e409fc53319754"
          },
          "downloads": -1,
          "filename": "piplite-0.4.3-py3-none-any.whl",
          "has_sig": false,
          "md5_digest": "0147712b461d1ed259754813d7d0d8be",
          "packagetype": "bdist_wheel",
          "python_version": "py3",
          "requires_python": "<3.12,>=3.11",
          "size": 7168,
          "upload_time": "2024-10-21T12:42:50.413450Z",
          "upload_time_iso_8601": "2024-10-21T12:42:50.413450Z",
          "url": "./piplite-0.4.3-py3-none-any.whl",
          "yanked": false,
          "yanked_reason": null
        }
      ]
    }
  },
  "pyodide-kernel": {
    "releases": {
      "0.4.3": [
        {
          "comment_text": "",
          "digests": {
            "md5": "59b14dedac8b54470703c5598cdf606c",
            "sha256": "0c9a83ff55ebeaef979a7bf33ded3265c51a4a2d5baa47ef79bbb83a53013426"
          },
          "downloads": -1,
          "filename": "pyodide_kernel-0.4.3-py3-none-any.whl",
          "has_sig": false,
          "md5_digest": "59b14dedac8b54470703c5598cdf606c",
          "packagetype": "bdist_wheel",
          "python_version": "py3",
          "requires_python": "<3.12,>=3.11",
          "size": 11007,
          "upload_time": "2024-10-21T12:42:50.413450Z",
          "upload_time_iso_8601": "2024-10-21T12:42:50.413450Z",
          "url": "./pyodide_kernel-0.4.3-py3-none-any.whl",
          "yanked": false,
          "yanked_reason": null
        }
      ]
    }
  },
  "widgetsnbextension": {
    "releases": {
      "3.6.999": [
        {
          "comment_text": "",
          "digests": {
            "md5": "43f79ddc62cbc6ba85a16317e9011a58",
            "sha256": "962113f5d9207641ace9cbf2b5f044c246054c51569724a23d2b5456760d2cf7"
          },
          "downloads": -1,
          "filename": "widgetsnbextension-3.6.999-py3-none-any.whl",
          "has_sig": false,
          "md5_digest": "43f79ddc62cbc6ba85a16317e9011a58",
          "packagetype": "bdist_wheel",
          "python_version": "py3",
          "requires_python": "<3.12,>=3.11",
          "size": 2367,
          "upload_time": "2024-10-21T12:42:50.413450Z",
          "upload_time_iso_8601": "2024-10-21T12:42:50.413450Z",
          "url": "./widgetsnbextension-3.6.999-py3-none-any.whl",
          "yanked": false,
          "yanked_reason": null
        }
      ],
      "4.0.999": [
        {
          "comment_text": "",
          "digests": {
            "md5": "b588f53d97ef5f08a01599d839665dca",
            "sha256": "c956526660f694e4129a697a265d07b70243878ee390dedc047463ce786a0586"
          },
          "downloads": -1,
          "filename": "widgetsnbextension-4.0.999-py3-none-any.whl",
          "has_sig": false,
          "md5_digest": "b588f53d97ef5f08a01599d839665dca",
          "packagetype": "bdist_wheel",
          "python_version": "py3",
          "requires_python": "<3.12,>=3.11",
          "size": 2369,
          "upload_time": "2024-10-21T12:42:50.413450Z",
          "upload_time_iso_8601": "2024-10-21T12:42:50.413450Z",
          "url": "./widgetsnbextension-4.0.999-py3-none-any.whl",
          "yanked": false,
          "yanked_reason": null
        }
      ]
    }
  }
}
```
