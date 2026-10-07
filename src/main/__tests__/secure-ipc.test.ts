import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const mainDir = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue
      out.push(...sourceFiles(full))
    } else if (name.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

describe('IPC handler registration', () => {
  it('goes through handleTrusted so every handler checks the sender', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(mainDir)) {
      const rel = relative(mainDir, file).split(sep).join('/')
      if (rel === 'secure-ipc.ts') continue
      const text = readFileSync(file, 'utf8')
      if (/\bipcMain\s*\.\s*(handle|handleOnce|on|once|addListener)\s*\(/.test(text)) {
        offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })
})
