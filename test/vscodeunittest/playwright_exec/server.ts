import * as http from 'node:http'

const host = '127.0.0.1'
const port = 3000

const server = http.createServer((request, response) => {
    if (!request.url || request.url === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>playwright repl integration</title></head>
<body>
  <h1 id="title">Ready</h1>
  <label for="name">Name</label>
  <input id="name" />
  <button id="apply" type="button">Apply</button>
  <script>
    const button = document.getElementById('apply')
    button.addEventListener('click', () => {
      const input = document.getElementById('name')
      const title = document.getElementById('title')
      title.textContent = input.value || 'Ready'
    })
  </script>
</body>
</html>`)
        return
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
})

server.listen(port, host, () => {
    console.log(`playwright repl integration test server listening at http://${host}:${port}`)
})

server.on('error', (error: Error) => {
    console.error(`failed to start playwright repl integration test server: ${error.message}`)
    process.exit(1)
})
