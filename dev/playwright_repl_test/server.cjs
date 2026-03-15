const http = require('node:http')

const HOST = '127.0.0.1'
const PORT = 4173

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Playwright Test Page</title>
  </head>
  <body>
    <main>
      <h1>Playwright Test Page</h1>
      <label for="name-input">Name</label>
      <input id="name-input" aria-label="Name" type="text" />
      <button type="button">Submit</button>
      <a href="/docs">Docs</a>
      <label>
        <input type="checkbox" aria-label="Accept terms" />
        Accept terms
      </label>
    </main>
  </body>
</html>`

const server = http.createServer((req, res) => {
    if (!req.url) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('bad request')
        return
    }

    const url = new URL(req.url, `http://${HOST}:${String(PORT)}`)

    if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('ok')
        return
    }

    if (req.method === 'GET' && url.pathname === '/docs') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<!doctype html><title>Docs</title><h1>Docs</h1><p>integration docs page</p>')
        return
    }

    if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(html)
        return
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
})

server.listen(PORT, HOST, () => {
    process.stdout.write(`playwright_repl_test server listening at http://${HOST}:${String(PORT)}\n`)
})

function shutdown(signal) {
    process.stdout.write(`received ${signal}, shutting down\n`)
    server.close((error) => {
        if (error) {
            process.stderr.write(`${error.message}\n`)
            process.exitCode = 1
            return
        }
        process.exitCode = 0
    })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
