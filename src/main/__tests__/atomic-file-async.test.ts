import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { backupPathFor, retryTransient, writeFileAtomicAsync } from '../atomic-file'

describe('writeFileAtomicAsync', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-atomic-async-'))
    file = join(dir, 'data.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates the directory and the file and leaves no temp file behind', async () => {
    const nested = join(dir, 'a', 'b', 'data.json')
    await writeFileAtomicAsync(nested, '{"v":1}')

    expect(readFileSync(nested, 'utf-8')).toBe('{"v":1}')
    expect(existsSync(nested + '.tmp')).toBe(false)
  })

  it('replaces an existing file', async () => {
    await writeFileAtomicAsync(file, '{"v":1}')
    await writeFileAtomicAsync(file, '{"v":2}')
    expect(readFileSync(file, 'utf-8')).toBe('{"v":2}')
  })

  it('keeps a backup of the previous good file when asked', async () => {
    await writeFileAtomicAsync(file, '{"v":1}', { backup: true })
    expect(existsSync(backupPathFor(file))).toBe(false)

    await writeFileAtomicAsync(file, '{"v":2}', { backup: true })
    expect(readFileSync(file, 'utf-8')).toBe('{"v":2}')
    expect(readFileSync(backupPathFor(file), 'utf-8')).toBe('{"v":1}')
  })

  it('never copies a corrupt file over the last good backup', async () => {
    await writeFileAtomicAsync(file, '{"v":1}', { backup: true })
    await writeFileAtomicAsync(file, '{"v":2}', { backup: true })
    writeFileSync(file, '{"v":') // simulate a torn file

    await writeFileAtomicAsync(file, '{"v":3}', { backup: true })

    expect(readFileSync(file, 'utf-8')).toBe('{"v":3}')
    expect(readFileSync(backupPathFor(file), 'utf-8')).toBe('{"v":1}')
  })

  it('removes the temp file and rethrows when the target cannot be replaced', async () => {
    // A directory at the target path makes the final rename fail on every platform.
    const { mkdirSync } = await import('fs')
    mkdirSync(file)

    await expect(writeFileAtomicAsync(file, '{"v":1}')).rejects.toBeTruthy()
    expect(existsSync(file + '.tmp')).toBe(false)
  })
})

describe('retryTransient', () => {
  const transient = (err: unknown) => (err as { code?: string }).code === 'EBUSY'

  it('returns the first success without waiting', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(retryTransient(fn, { attempts: 3, delayMs: 0, isTransient: transient })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries a transient error and then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }))
      .mockResolvedValue('ok')
    await expect(retryTransient(fn, { attempts: 3, delayMs: 0, isTransient: transient })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('gives up after the last attempt', async () => {
    const err = Object.assign(new Error('busy'), { code: 'EBUSY' })
    const fn = vi.fn().mockRejectedValue(err)
    await expect(retryTransient(fn, { attempts: 3, delayMs: 0, isTransient: transient })).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry an error that is not transient', async () => {
    const err = Object.assign(new Error('nope'), { code: 'ENOENT' })
    const fn = vi.fn().mockRejectedValue(err)
    await expect(retryTransient(fn, { attempts: 3, delayMs: 0, isTransient: transient })).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
