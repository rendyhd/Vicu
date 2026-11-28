import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
// @ts-expect-error a plain script without types
import { portableClosure } from '../../../scripts/portable-closure.mjs'

// The web version runs part of the main process's code in a browser tab. Nothing it pulls in may
// need Electron or Node: what differs between the two hosts goes through the seam (`@host/*`,
// src/main/host on the desktop, src/web/host on the web).

const repo = join(__dirname, '..', '..', '..')

function exportedNames(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const names = new Set<string>()
  for (const match of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class|interface|type)\s+([A-Za-z0-9_]+)/gm)) names.add(match[1])
  for (const match of source.matchAll(/^export\s+(?:type\s+)?\{([^}]+)\}/gm)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) names.add(name)
    }
  }
  return [...names].sort()
}

describe('the code the web version runs', () => {
  const closure = portableClosure(['src/web/main.ts']) as {
    files: string[]
    leaks: Array<{ file: string; module: string }>
    missing: Array<{ file: string; module: string }>
  }

  it('is found at all', () => {
    expect(closure.files.length).toBeGreaterThan(80)
    expect(closure.files).toContain('src/main/handlers/portable.ts')
  })

  it('imports neither Electron nor a Node built-in', () => {
    expect(closure.leaks.map((leak) => `${leak.file} imports ${leak.module}`)).toEqual([])
  })

  it('resolves every relative and aliased import', () => {
    expect(closure.missing.map((miss) => `${miss.file} imports ${miss.module}`)).toEqual([])
  })

  it('does not name process or Buffer outside the desktop side of the seam', () => {
    const offenders = closure.files
      .filter((file) => !file.startsWith('src/main/host/'))
      .filter((file) => /(?<![.\w'"`])(?:process\.(?:platform|env|versions|cwd|argv)|Buffer\.(?:from|alloc|concat|isBuffer))/.test(
        readFileSync(join(repo, file), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''),
      ))
    expect(offenders).toEqual([])
  })
})

describe('the host seam', () => {
  const desktop = join(repo, 'src', 'main', 'host')
  const web = join(repo, 'src', 'web', 'host')
  const modules = readdirSync(desktop).filter((name) => name.endsWith('.ts'))

  it('has a web side for every module of the desktop side', () => {
    expect(readdirSync(web).filter((name) => name.endsWith('.ts')).sort()).toEqual([...modules].sort())
  })

  it.each(modules)('%s exports on the web what shared code may import from the desktop side', (name) => {
    const fromDesktop = exportedNames(join(desktop, name))
    const fromWeb = new Set(exportedNames(join(web, name)))
    // What only the desktop's own start-up uses (a window to notify, a file path) is listed here.
    const desktopOnly = DESKTOP_ONLY[name] ?? []
    expect(fromDesktop.filter((exported) => !fromWeb.has(exported) && !desktopOnly.includes(exported))).toEqual([])
  })
})

/** Exports of the desktop side that shared code never imports: only src/main's own start-up does. */
const DESKTOP_ONLY: Record<string, string[]> = { 'notify.ts': ['setNotificationsMainWindow'] }
