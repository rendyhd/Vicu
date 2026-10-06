import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { OfflineAttachmentFiles } from '../offline/attachments'

describe('OfflineAttachmentFiles', () => {
  let root: string
  let dir: string
  let files: OfflineAttachmentFiles

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vicu-offline-att-'))
    dir = join(root, 'offline-attachments')
    files = new OfflineAttachmentFiles(dir)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('stores bytes under a generated name and reads them back', async () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 0, 7])
    const name = await files.save(bytes)

    expect(name).toMatch(/^[a-f0-9]{16}\.bin$/)
    expect([...(await files.read(name))]).toEqual([...bytes])
    // No temp file is left behind.
    expect(readdirSync(dir)).toEqual([name])
  })

  it('never uses a name the caller chose, so a hostile file name cannot escape the folder', async () => {
    await expect(files.read('../../config.json')).rejects.toThrow(/invalid/i)
    await expect(files.read('..\\config.json')).rejects.toThrow(/invalid/i)
    await expect(files.remove('../outside.bin')).rejects.toThrow(/invalid/i)
  })

  it('removes a file and ignores one that is already gone', async () => {
    const name = await files.save(new Uint8Array([1]))
    await files.remove(name)
    expect(existsSync(join(dir, name))).toBe(false)
    await expect(files.remove(name)).resolves.toBeUndefined()
  })

  it('sweeps files nothing refers to any more, keeping the referenced ones', async () => {
    const keep = await files.save(new Uint8Array([1]))
    const orphan = await files.save(new Uint8Array([2]))
    writeFileSync(join(dir, 'leftover.bin.tmp'), 'partial')
    writeFileSync(join(dir, 'notes.txt'), 'not ours')

    const removed = await files.sweep(new Set([keep]))

    expect(removed).toBe(2) // the orphan and the stale temp file
    expect(existsSync(join(dir, keep))).toBe(true)
    expect(existsSync(join(dir, orphan))).toBe(false)
    expect(existsSync(join(dir, 'leftover.bin.tmp'))).toBe(false)
    expect(existsSync(join(dir, 'notes.txt'))).toBe(true) // files that are not ours are left alone
  })

  it('sweeping a folder that does not exist is fine', async () => {
    mkdirSync(root, { recursive: true })
    await expect(files.sweep(new Set())).resolves.toBe(0)
  })
})
