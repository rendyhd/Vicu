import { describe, expect, it } from 'vitest'
import { OSASCRIPT_PATH, powershellPath } from '../system-tools'

const flat = (path: string) => path.split(String.fromCharCode(92)).join('/').toLowerCase()

describe('system tool paths', () => {
  it('puts PowerShell in the system folder, never a bare name', () => {
    expect(flat(powershellPath({ SystemRoot: 'D:/Win' }))).toBe('d:/win/system32/windowspowershell/v1.0/powershell.exe')
  })

  it('falls back to the Windows folder without SystemRoot', () => {
    expect(flat(powershellPath({}))).toContain('c:/windows/system32/windowspowershell/v1.0/powershell.exe')
  })

  it('runs osascript from /usr/bin', () => {
    expect(OSASCRIPT_PATH).toBe('/usr/bin/osascript')
  })
})
