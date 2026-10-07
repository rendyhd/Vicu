import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { backupPathFor, isTransientFileError, retryTransientSync, writeFileAtomic } from '../atomic-file'

// On Windows another process (Defender, the indexer, a backup tool) can hold a file for a moment
// and fail the rename over it with EPERM / EBUSY / EACCES (F2). The hooks stand in for the locked
// file: the real fs does everything else.

const locked = (code = 'EPERM'): NodeJS.ErrnoException => Object.assign(new Error(`${code}: operation not permitted, rename`), { code })

describe('writeFileAtomic with a file another process holds', () => {
  let dir: string
  let file: string
  let warn: ReturnType<typeof vi.spyOn>
  let sleeps: number[]
  let realRename: (from: string, to: string) => void

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-atomic-transient-'))
    file = join(dir, 'data.json')
    sleeps = []
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { renameSync } = await import('fs')
    realRename = renameSync
  })

  afterEach(() => {
    warn.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  const hooks = (rename: (from: string, to: string) => void) => ({ rename, sleep: (ms: number) => void sleeps.push(ms) })

  it.each(['EPERM', 'EBUSY', 'EACCES'])('retries a rename that fails with %s until the file is released', (code) => {
    writeFileAtomic(file, '{"v":1}', { backup: true })
    let failures = 2
    const rename = vi.fn((from: string, to: string) => {
      if (failures-- > 0) throw locked(code)
      realRename(from, to)
    })

    writeFileAtomic(file, '{"v":2}', { backup: true, hooks: hooks(rename) })

    expect(rename).toHaveBeenCalledTimes(3)
    expect(readFileSync(file, 'utf-8')).toBe('{"v":2}')
    expect(readFileSync(backupPathFor(file), 'utf-8')).toBe('{"v":1}')
    expect(existsSync(file + '.tmp')).toBe(false)
    // Short, growing waits: the main thread is never blocked for long.
    expect(sleeps).toEqual([15, 30])
  })

  it('does not wait at all when the rename works', () => {
    writeFileAtomic(file, '{"v":1}', { hooks: hooks(realRename) })
    expect(sleeps).toEqual([])
  })

  it('bounds the retries, then writes the new contents in place when the file stays locked', () => {
    writeFileAtomic(file, '{"v":1}', { backup: true })
    const rename = vi.fn(() => {
      throw locked()
    })

    writeFileAtomic(file, '{"v":2}', { backup: true, hooks: hooks(rename) })

    expect(rename).toHaveBeenCalledTimes(6)
    expect(sleeps).toEqual([15, 30, 60, 120, 240])
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThan(600)
    // The data is saved, the old version is in the backup and no temp file is left over.
    expect(readFileSync(file, 'utf-8')).toBe('{"v":2}')
    expect(readFileSync(backupPathFor(file), 'utf-8')).toBe('{"v":1}')
    expect(existsSync(file + '.tmp')).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('wrote it in place'))
  })

  it('throws the rename error, leaving the old file and no temp file, when the in-place write fails too', () => {
    writeFileAtomic(file, '{"v":1}', { backup: true })
    const rename = vi.fn(() => {
      throw locked('EBUSY')
    })
    const writeInPlace = vi.fn(() => {
      throw locked('EBUSY')
    })

    expect(() => writeFileAtomic(file, '{"v":2}', { backup: true, hooks: { ...hooks(rename), writeInPlace } })).toThrow(/EBUSY/)

    expect(writeInPlace).toHaveBeenCalledTimes(1)
    expect(readFileSync(file, 'utf-8')).toBe('{"v":1}')
    expect(existsSync(file + '.tmp')).toBe(false)
  })

  it('does not retry or write in place for an error that is not a lock', () => {
    writeFileAtomic(file, '{"v":1}')
    const rename = vi.fn(() => {
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    })
    const writeInPlace = vi.fn()

    expect(() => writeFileAtomic(file, '{"v":2}', { hooks: { ...hooks(rename), writeInPlace } })).toThrow(/ENOSPC/)

    expect(rename).toHaveBeenCalledTimes(1)
    expect(writeInPlace).not.toHaveBeenCalled()
    expect(sleeps).toEqual([])
    expect(readFileSync(file, 'utf-8')).toBe('{"v":1}')
    expect(existsSync(file + '.tmp')).toBe(false)
  })

  it('creates the file in place when the target did not exist yet and cannot be renamed onto', () => {
    const rename = vi.fn(() => {
      throw locked('EACCES')
    })
    writeFileAtomic(file, '{"v":1}', { hooks: hooks(rename) })
    expect(readFileSync(file, 'utf-8')).toBe('{"v":1}')
  })

  it('a leftover temp file from an earlier locked save does not get in the way', () => {
    writeFileSync(file + '.tmp', '{"v":9', 'utf-8')
    writeFileAtomic(file, '{"v":1}', { hooks: hooks(realRename) })
    expect(readFileSync(file, 'utf-8')).toBe('{"v":1}')
    expect(existsSync(file + '.tmp')).toBe(false)
  })
})

describe('retryTransientSync and isTransientFileError', () => {
  it('recognizes the lock errors and nothing else', () => {
    for (const code of ['EPERM', 'EBUSY', 'EACCES']) expect(isTransientFileError(locked(code))).toBe(true)
    expect(isTransientFileError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(false)
    expect(isTransientFileError(new Error('EPERM in the message only'))).toBe(false)
    expect(isTransientFileError(undefined)).toBe(false)
  })

  it('returns the first result that works and stops waiting', () => {
    const sleep = vi.fn()
    let calls = 0
    const result = retryTransientSync(
      () => {
        if (++calls < 3) throw locked()
        return 'done'
      },
      { attempts: 5, delayMs: 10, isTransient: isTransientFileError, sleep },
    )
    expect(result).toBe('done')
    expect(sleep.mock.calls).toEqual([[10], [20]])
  })

  it('gives up after the attempts it was given, with the last error', () => {
    const sleep = vi.fn()
    expect(() =>
      retryTransientSync(
        () => {
          throw locked('EBUSY')
        },
        { attempts: 3, delayMs: 5, isTransient: isTransientFileError, sleep },
      ),
    ).toThrow(/EBUSY/)
    expect(sleep).toHaveBeenCalledTimes(2)
  })
})
