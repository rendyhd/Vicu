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
