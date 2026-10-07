import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { APP_ID } from '../app-id'

const root = resolve(__dirname, '..', '..', '..')

describe('APP_ID', () => {
  it('matches the electron-builder appId, so toasts attribute to the installed shortcut', () => {
    const yml = readFileSync(resolve(root, 'electron-builder.yml'), 'utf8')
    const match = /^appId:\s*(\S+)\s*$/m.exec(yml)
    expect(match).not.toBeNull()
    expect(match![1]).toBe(APP_ID)
  })

  it('matches the Linux desktopName in package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { desktopName?: string }
    expect(pkg.desktopName).toBe(APP_ID)
  })

  it('is not hardcoded as any other id in the main process sources', () => {
    const index = readFileSync(resolve(root, 'src/main/index.ts'), 'utf8')
    expect(index).not.toContain("'com.vicu.app'")
    expect(index).toContain('setAppUserModelId(APP_ID)')
  })
})
