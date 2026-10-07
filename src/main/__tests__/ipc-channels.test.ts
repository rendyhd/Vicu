import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

// The preload scripts and the main process agree on the IPC surface: every channel a window can
// invoke has a handler, and no handler is left without a caller.

const srcDir = join(__dirname, '..', '..')

function sourceFiles(dir: string, accept: (name: string) => boolean): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue
      out.push(...sourceFiles(full, accept))
    } else if (accept(name)) {
      out.push(full)
    }
  }
  return out
}

function channels(files: string[], pattern: RegExp): Set<string> {
  const found = new Set<string>()
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) found.add(match[1])
  }
  return found
}

const invoked = channels(
  sourceFiles(join(srcDir, 'preload'), (name) => name.endsWith('.ts') && !name.endsWith('.d.ts')),
  /ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g,
)
const handled = channels(
  sourceFiles(join(srcDir, 'main'), (name) => name.endsWith('.ts')),
  /handleTrusted\(\s*['"]([^'"]+)['"]/g,
)

// What main sends to a window must have a listener in a preload script, or the message is dropped
// without a trace (navigate-to-task was sent by reminders and Quick View for a long time and
// nothing received it, F5).
const mainFiles = sourceFiles(join(srcDir, 'main'), (name) => name.endsWith('.ts'))
const sent = channels(mainFiles, /\.send\(\s*['"]([^'"]+)['"]/g)
for (const channel of channels(mainFiles, /sendToAppWindows\(\s*['"]([^'"]+)['"]/g)) sent.add(channel)
// The offline queue's events are named once, in an object.
for (const channel of channels([join(srcDir, 'main', 'offline', 'service.ts')], /(?:changed|replayed|authProblem):\s*['"]([^'"]+)['"]/g)) sent.add(channel)
const listened = channels(
  sourceFiles(join(srcDir, 'preload'), (name) => name.endsWith('.ts') && !name.endsWith('.d.ts')),
  /ipcRenderer\.on(?:ce)?\(\s*['"]([^'"]+)['"]/g,
)

/** Channels main sends that no window listens to yet. Each one is a bug to fix, not a pattern to copy. */
const KNOWN_UNHEARD = new Set<string>([])

describe('IPC channels', () => {
  it('finds the channels at all', () => {
    expect(invoked.size).toBeGreaterThan(50)
    expect(handled.size).toBeGreaterThan(50)
  })

  it('has a handler for every channel the preload scripts invoke', () => {
    expect([...invoked].filter((channel) => !handled.has(channel)).sort()).toEqual([])
  })

  it('has a caller for every handler', () => {
    expect([...handled].filter((channel) => !invoked.has(channel)).sort()).toEqual([])
  })

  it('finds the channels main sends', () => {
    expect(sent.size).toBeGreaterThan(15)
    expect(sent.has('navigate-to-task')).toBe(true)
    expect(listened.has('navigate')).toBe(true)
  })

  it('has a listener in a preload script for every channel main sends to a window', () => {
    expect([...sent].filter((channel) => !listened.has(channel) && !KNOWN_UNHEARD.has(channel)).sort()).toEqual([])
  })

  it('lists only channels that really are unheard', () => {
    expect([...KNOWN_UNHEARD].filter((channel) => listened.has(channel) || !sent.has(channel))).toEqual([])
  })

  // A renderer that saves its whole config snapshot can overwrite what main changed in the
  // meantime (window bounds, custom lists...). Preferences go through save-config-patch, the
  // connection through save-connection-config.
  it('has no full-snapshot config save', () => {
    expect(handled.has('save-config')).toBe(false)
    expect(invoked.has('save-config')).toBe(false)
    expect(handled.has('save-config-patch')).toBe(true)
    expect(handled.has('save-connection-config')).toBe(true)
  })
})
