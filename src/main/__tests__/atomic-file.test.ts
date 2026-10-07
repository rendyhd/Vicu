import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const fsState = vi.hoisted(() => ({ failRename: false }))

// Lets a test make the final rename fail, which is the closest portable stand-in
// for a crash between "temp file written" and "temp file moved into place".
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      if (fsState.failRename) throw new Error('EPERM: simulated rename failure')
      return actual.renameSync(from, to)
    },
  }
})

import {
  backupPathFor,
  readFileWithBackup,
  removeFileAndBackup,
  stripBom,
  writeFileAtomic,
} from '../atomic-file'

const parseJson = (raw: string) => JSON.parse(raw) as { v: number }

describe('atomic file helper', () => {
  let dir: string
  let file: string
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-atomic-'))
    file = join(dir, 'data.json')
    fsState.failRename = false
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates the file and its directory, leaving no temp file behind', () => {
    const nested = join(dir, 'a', 'b', 'data.json')
    writeFileAtomic(nested, '{"v":1}')

    expect(readFileSync(nested, 'utf-8')).toBe('{"v":1}')
    expect(existsSync(nested + '.tmp')).toBe(false)
  })

  it('keeps a backup of the previous good file when asked', () => {
    writeFileAtomic(file, '{"v":1}', { backup: true })
    expect(existsSync(backupPathFor(file))).toBe(false)

    writeFileAtomic(file, '{"v":2}', { backup: true })
    expect(readFileSync(file, 'utf-8')).toBe('{"v":2}')
    expect(readFileSync(backupPathFor(file), 'utf-8')).toBe('{"v":1}')
  })

  it('does not write a backup unless asked', () => {
    writeFileAtomic(file, '{"v":1}')
    writeFileAtomic(file, '{"v":2}')

    expect(existsSync(backupPathFor(file))).toBe(false)
  })

  it('never lets a corrupt file replace the last good backup', () => {
    writeFileAtomic(file, '{"v":1}', { backup: true })
    writeFileAtomic(file, '{"v":2}', { backup: true })
    writeFileSync(file, '{"v":3', 'utf-8') // truncated by something else

    writeFileAtomic(file, '{"v":4}', { backup: true })

    expect(readFileSync(file, 'utf-8')).toBe('{"v":4}')
    expect(readFileSync(backupPathFor(file), 'utf-8')).toBe('{"v":1}')
  })

  it('leaves the old file intact when the swap fails, and removes the temp file', () => {
    writeFileAtomic(file, '{"v":1}', { backup: true })

    fsState.failRename = true
    expect(() => writeFileAtomic(file, '{"v":2}', { backup: true })).toThrow(/simulated/)
    fsState.failRename = false

    expect(readFileSync(file, 'utf-8')).toBe('{"v":1}')
    expect(existsSync(file + '.tmp')).toBe(false)
    expect(readFileWithBackup(file, parseJson)).toEqual({ value: { v: 1 }, recovered: false })
  })

  it('ignores a partial temp file left by an interrupted write', () => {
    writeFileAtomic(file, '{"v":1}')
    writeFileSync(file + '.tmp', '{"v":2', 'utf-8') // process died mid-write

    expect(readFileWithBackup(file, parseJson)).toEqual({ value: { v: 1 }, recovered: false })

    writeFileAtomic(file, '{"v":3}')
    expect(readFileWithBackup(file, parseJson)).toEqual({ value: { v: 3 }, recovered: false })
    expect(existsSync(file + '.tmp')).toBe(false)
  })

  // F9: editors and tools on Windows (Notepad, PowerShell 5's Out-File) save UTF-8 with a byte order
  // mark. JSON.parse rejects it, so the file used to be treated as corrupt: the backup was loaded and
  // the next save overwrote the user's file.
  describe('a file saved with a UTF-8 byte order mark (F9)', () => {
    const BOM = '﻿'

    it('stripBom removes one leading mark and nothing else', () => {
      expect(stripBom(BOM + '{"v":1}')).toBe('{"v":1}')
      expect(stripBom('{"v":1}')).toBe('{"v":1}')
      expect(stripBom('')).toBe('')
      expect(stripBom(BOM + BOM + 'x')).toBe(BOM + 'x')
    })

    it('reads the file as it is: not corrupt, not recovered, nothing logged', () => {
      writeFileSync(file, BOM + '{"v":7}', 'utf-8')

      expect(readFileWithBackup(file, parseJson)).toEqual({ value: { v: 7 }, recovered: false })
      expect(warn).not.toHaveBeenCalled()
      expect(existsSync(backupPathFor(file))).toBe(false)
    })

    it('reads a backup that has one too', () => {
      writeFileSync(file, '{"v":3', 'utf-8') // torn
      writeFileSync(backupPathFor(file), BOM + '{"v":2}', 'utf-8')

      expect(readFileWithBackup(file, parseJson)).toEqual({ value: { v: 2 }, recovered: true })
    })

    it('counts as a good file when the next save backs it up, so the user data is kept', () => {
      writeFileSync(file, BOM + '{"v":7}', 'utf-8')

      writeFileAtomic(file, '{"v":8}', { backup: true })

      expect(readFileSync(backupPathFor(file), 'utf-8')).toBe(BOM + '{"v":7}')
      expect(readFileSync(file, 'utf-8')).toBe('{"v":8}')
    })

    it('is still corrupt when the JSON itself is broken', () => {
      writeFileSync(file, BOM + '{"v":', 'utf-8')
      expect(readFileWithBackup(file, parseJson)).toBeNull()
    })
  })

  it('returns null for a file that was never written', () => {
    expect(readFileWithBackup(file, parseJson)).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not resurrect data from a backup when the main file is gone', () => {
    writeFileAtomic(file, '{"v":1}', { backup: true })
    writeFileAtomic(file, '{"v":2}', { backup: true })
    rmSync(file)

    expect(readFileWithBackup(file, parseJson)).toBeNull()
  })

  it('loads the backup when the main file does not parse, logs it and repairs the main file', () => {
    writeFileAtomic(file, '{"v":1}', { backup: true })
    writeFileAtomic(file, '{"v":2}', { backup: true })
    writeFileSync(file, '', 'utf-8') // zero-length file, the classic crash result

    expect(readFileWithBackup(file, parseJson)).toEqual({ value: { v: 1 }, recovered: true })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('data.json')

    // Repaired: the next read is a normal one, and the backup is still there.
    expect(readFileWithBackup(file, parseJson)).toEqual({ value: { v: 1 }, recovered: false })
    expect(readFileSync(backupPathFor(file), 'utf-8')).toBe('{"v":1}')
  })

  it('returns null and logs when neither the file nor its backup is usable', () => {
    writeFileSync(file, 'garbage', 'utf-8')
    expect(readFileWithBackup(file, parseJson)).toBeNull()

    writeFileSync(backupPathFor(file), 'also garbage', 'utf-8')
    expect(readFileWithBackup(file, parseJson)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('removes the file, its backup and its temp file', () => {
    writeFileAtomic(file, '{"v":1}', { backup: true })
    writeFileAtomic(file, '{"v":2}', { backup: true })
    writeFileSync(file + '.tmp', 'x', 'utf-8')

    removeFileAndBackup(file)

    expect(existsSync(file)).toBe(false)
    expect(existsSync(backupPathFor(file))).toBe(false)
    expect(existsSync(file + '.tmp')).toBe(false)
    expect(() => removeFileAndBackup(file)).not.toThrow()
  })
})
