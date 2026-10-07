import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadFileForUpload, type UploadFileDeps } from '../upload-file'

function fakeDeps(over: Partial<UploadFileDeps> & { size?: number; isFile?: boolean } = {}): UploadFileDeps & {
  readFile: ReturnType<typeof vi.fn<(path: string) => Promise<Buffer>>>
} {
  return {
    stat: over.stat ?? (async () => ({ size: over.size ?? 10, isFile: () => over.isFile ?? true })),
    readFile: vi.fn(over.readFile ?? (async () => Buffer.from('0123456789'))),
    checkSize: over.checkSize ?? (async () => null),
  }
}

describe('loadFileForUpload', () => {
  it('reads a file that fits', async () => {
    const deps = fakeDeps()
    const result = await loadFileForUpload('C:\\x\\a.txt', deps)
    expect(result).toEqual({ ok: true, buffer: Buffer.from('0123456789') })
    expect(deps.readFile).toHaveBeenCalledTimes(1)
  })

  it('checks the size from stat and does not read a file over the limit', async () => {
    const checked: number[] = []
    const deps = fakeDeps({
      size: 5_000_000_000,
      checkSize: async (size) => {
        checked.push(size)
        return 'File is too large to upload (5000 MB; this server accepts up to 20 MB)'
      },
    })
    const result = await loadFileForUpload('/big.iso', deps)
    expect(result).toEqual({ ok: false, error: 'File is too large to upload (5000 MB; this server accepts up to 20 MB)' })
    expect(checked).toEqual([5_000_000_000])
    expect(deps.readFile).not.toHaveBeenCalled()
  })

  it('does not read a directory', async () => {
    const deps = fakeDeps({ isFile: false })
    const result = await loadFileForUpload('/some/folder', deps)
    expect(result.ok).toBe(false)
    expect(deps.readFile).not.toHaveBeenCalled()
  })

  it('reports a file that cannot be read instead of throwing', async () => {
    const deps = fakeDeps({
      readFile: async () => {
        throw new Error('EACCES: permission denied')
      },
    })
    const result = await loadFileForUpload('/locked.txt', deps)
    expect(result).toEqual({ ok: false, error: 'Could not read the file: EACCES: permission denied' })
  })

  it('reports a file that vanished before it was read', async () => {
    const deps = fakeDeps({
      stat: async () => {
        throw new Error('ENOENT: no such file')
      },
    })
    const result = await loadFileForUpload('/gone.txt', deps)
    expect(result).toEqual({ ok: false, error: 'Could not read the file: ENOENT: no such file' })
  })

  it('does not trust a stale size: a file that grew past the limit after stat is refused too', async () => {
    const deps = fakeDeps({
      size: 10,
      readFile: async () => Buffer.alloc(30),
      checkSize: async (size) => (size > 20 ? 'too large' : null),
    })
    const result = await loadFileForUpload('/growing.log', deps)
    expect(result).toEqual({ ok: false, error: 'too large' })
  })
})

describe('loadFileForUpload with the real file system', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-upload-file-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads a real file asynchronously', async () => {
    const path = join(dir, 'hello.txt')
    writeFileSync(path, 'hello')
    const result = await loadFileForUpload(path, { checkSize: async () => null })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.buffer.toString()).toBe('hello')
  })

  it('refuses a real directory', async () => {
    const result = await loadFileForUpload(dir, { checkSize: async () => null })
    expect(result.ok).toBe(false)
  })
})
