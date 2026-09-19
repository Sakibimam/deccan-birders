/** Serves apps/reader on http://localhost:4173 — it is a static file, nothing to build. */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const file = fileURLToPath(new URL('../apps/reader/index.html', import.meta.url))
createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(readFileSync(file))
}).listen(4173, () => console.log('Reader on http://localhost:4173'))
