// A small server for the web version's files, shaped like the container's nginx: the built page
// (out/web) at the root, /api/ forwarded to a Vikunja server on the same origin, the app's page for
// every other address (an OIDC sign-in comes back to /auth/openid/<provider>), and the container's
// security headers when its config is there to read them from. Used by web.mjs; also runs alone:
//
//   node scripts/ui-verify/web-server.mjs [--port 5176] [--api http://127.0.0.1:3456]

import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const REPO = resolve(fileURLToPath(import.meta.url), '..', '..', '..')
const ROOT = join(REPO, 'out', 'web')
const HEADERS_FILE = join(REPO, 'docker', 'web', 'security-headers.conf')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
}

/** The `add_header Name "value" always;` lines of the container's config, so the page is tested under its real policy. */
export function securityHeaders(file = HEADERS_FILE) {
  if (!existsSync(file)) return {}
  const headers = {}
  for (const match of readFileSync(file, 'utf8').matchAll(/^\s*add_header\s+([A-Za-z-]+)\s+"([^"]*)"/gm)) headers[match[1]] = match[2]
  return headers
}

export function startWebServer({ port = 5176, api = 'http://127.0.0.1:3456', root = ROOT, headers = securityHeaders() } = {}) {
  if (!existsSync(join(root, 'index.html'))) throw new Error(`${root} has no index.html: run \`npm run build:web\` first.`)
  const target = new URL(api)

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname.startsWith('/api/')) {
      const send = target.protocol === 'https:' ? httpsRequest : httpRequest
      const upstream = send(
        { hostname: target.hostname, port: target.port, path: url.pathname + url.search, method: req.method, headers: { ...req.headers, host: target.host } },
        (answer) => {
          res.writeHead(answer.statusCode ?? 502, answer.headers)
          answer.pipe(res)
        },
      )
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end('The server could not be reached')
      })
      req.pipe(upstream)
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end()
      return
    }
    const wanted = normalize(join(root, decodeURIComponent(url.pathname)))
    const inside = wanted === root || wanted.startsWith(root + sep)
    const isFile = inside && existsSync(wanted) && statSync(wanted).isFile()
    // An address that is no file is the app's (its sign-in comes back to one); a missing asset is a 404.
    if (!isFile && url.pathname.startsWith('/assets/')) {
      res.writeHead(404).end()
      return
    }
    const file = isFile ? wanted : join(root, 'index.html')
    const html = extname(file) === '.html'
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': html ? 'no-cache' : url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...headers,
    })
    if (req.method === 'HEAD') res.end()
    else res.end(readFileSync(file))
  })

  return new Promise((done, failed) => {
    server.once('error', failed)
    server.listen(port, '127.0.0.1', () => done({ url: `http://127.0.0.1:${port}`, close: () => new Promise((closed) => server.close(closed)) }))
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { port: { type: 'string' }, api: { type: 'string' } } })
  const started = await startWebServer({ port: values.port ? Number(values.port) : undefined, api: values.api })
  console.log(`Vicu web at ${started.url}`)
}
