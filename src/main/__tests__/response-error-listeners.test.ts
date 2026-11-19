import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { describe, expect, it } from 'vitest'

// Electron's net.request destroys the response with a network error that comes after the headers
// (ERR_NETWORK_CHANGED when a Mac wakes or Wi-Fi switches) as well as failing the request. A
// response nobody listens to for 'error' turns that into an uncaught exception in main: the
// "A JavaScript error occurred in the main process" dialog. So every handler of a request's
// 'response' event listens to the response's 'error' too.

const MAIN = join(__dirname, '..')

/** Files whose 'response' is not Electron's, with the reason they need no listener. */
const NOT_ELECTRON_NET: Record<string, string> = {
  // Node's own http/https: an IncomingMessage emits 'error' only when something listens to it.
  'ai/transport.ts': "Node's http, not net.request",
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__') out.push(...sourceFiles(path))
    } else if (name.endsWith('.ts')) {
      out.push(path)
    }
  }
  return out
}

describe('response error listeners', () => {
  it("every 'response' handler in main listens to the response's 'error'", () => {
    const missing: string[] = []
    let found = 0
    for (const file of sourceFiles(MAIN)) {
      if (relative(MAIN, file).replace(/\\/g, '/') in NOT_ELECTRON_NET) continue
      const text = readFileSync(file, 'utf8')
      const handlers = [...text.matchAll(/\.on\(\s*'response'\s*,\s*(?:async\s*)?\(?\s*(\w+)[^)]*\)?\s*=>/g)]
      handlers.forEach((match, i) => {
        found += 1
        const end = handlers[i + 1]?.index ?? text.length
        const body = text.slice(match.index, end)
        if (!new RegExp(`\\b${match[1]}\\.on\\(\\s*'error'`).test(body)) {
          const line = text.slice(0, match.index).split('\n').length
          missing.push(`${relative(MAIN, file)}:${line} (${match[1]})`)
        }
      })
    }
    expect(found, 'the scan found no handlers; has the pattern changed?').toBeGreaterThanOrEqual(5)
    expect(missing, `add ${'`'}response.on('error', ...)${'`'} to these handlers`).toEqual([])
  })
})
