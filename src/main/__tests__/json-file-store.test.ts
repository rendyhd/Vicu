import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const fsState = vi.hoisted(() => ({ writeDelayMs: 0, active: 0, maxActive: 0, writes: [] as string[], failNext: false }))

// Counts how many atomic writes run at the same time and records what each wrote, so a
// test can prove writes are serialized and coalesced.
vi.mock('../atomic-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../atomic-file')>()
  return {
    ...actual,
    writeFileAtomicAsync: async (path: string, data: string, options?: { backup?: boolean }) => {
      fsState.active++
      fsState.maxActive = Math.max(fsState.maxActive, fsState.active)
      try {
        if (fsState.writeDelayMs > 0) await new Promise((r) => setTimeout(r, fsState.writeDelayMs))
        if (fsState.failNext) {
          fsState.failNext = false
          throw new Error('disk full')
        }
        fsState.writes.push(data)
        await actual.writeFileAtomicAsync(path, data, options)
      } finally {
        fsState.active--
      }
    },
  }
})

import { JsonFileStore } from '../json-file-store'
import { backupPathFor } from '../atomic-file'

interface Doc {
  items: string[]
}

function parseDoc(json: unknown): Doc {
  if (!json || typeof json !== 'object' || !Array.isArray((json as Doc).items)) throw new Error('not a Doc')
  return { items: (json as Doc).items.map(String) }
}

describe('JsonFileStore', () => {
  let dir: string
  let file: string
  let warn: ReturnType<typeof vi.spyOn>

  const make = (backup = true, quarantineCorrupt = true) =>
    new JsonFileStore<Doc>({
      path: file,
      backup,
      quarantineCorrupt,
      label: 'test',
      empty: () => ({ items: [] }),
      parse: parseDoc,
    })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-json-store-'))
    file = join(dir, 'doc.json')
    fsState.writeDelayMs = 0
    fsState.active = 0
    fsState.maxActive = 0
    fsState.writes = []
    fsState.failNext = false
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('loading', () => {
    it('starts empty when nothing was saved yet', () => {
      const store = make()
      expect(store.load()).toBe('missing')
      expect(store.state).toEqual({ items: [] })
    })

    it('reads the saved file', () => {
      writeFileSync(file, JSON.stringify({ items: ['a', 'b'] }))
      const store = make()
      expect(store.load()).toBe('ok')
      expect(store.state.items).toEqual(['a', 'b'])
    })

    it('loads the backup when the main file does not parse, instead of returning an empty state', () => {
      writeFileSync(file, '{"items": ["a", ')
      writeFileSync(backupPathFor(file), JSON.stringify({ items: ['from-backup'] }))

      const store = make()
      expect(store.load()).toBe('recovered')
      expect(store.state.items).toEqual(['from-backup'])
      // The backup was copied back so a later start sees the good data too.
      expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ items: ['from-backup'] })
    })

    it('loads the backup when the main file parses but has the wrong shape', () => {
      writeFileSync(file, JSON.stringify({ unexpected: true }))
      writeFileSync(backupPathFor(file), JSON.stringify({ items: ['good'] }))

      const store = make()
      expect(store.load()).toBe('recovered')
      expect(store.state.items).toEqual(['good'])
    })

    it('keeps a corrupt file aside when there is no usable backup, then starts empty', () => {
      writeFileSync(file, 'garbage')

      const store = make()
      expect(store.load()).toBe('corrupt')
      expect(store.state).toEqual({ items: [] })
      const kept = readdirSync(dir).filter((name) => name.startsWith('doc.json.corrupt-'))
      expect(kept).toHaveLength(1)
      expect(readFileSync(join(dir, kept[0]), 'utf-8')).toBe('garbage')
    })

    it('does not keep corrupt copies for a disposable file', () => {
      writeFileSync(file, 'garbage')
      const store = make(false, false)
      expect(store.load()).toBe('corrupt')
      expect(readdirSync(dir).filter((name) => name.includes('corrupt'))).toHaveLength(0)
    })
  })

  describe('saving', () => {
    it('writes the state compactly (no pretty printing) and keeps a backup of the previous version', async () => {
      const store = make()
      store.load()
      store.state.items.push('one')
      await store.save()
      store.state.items.push('two')
      await store.save()

      expect(readFileSync(file, 'utf-8')).toBe('{"items":["one","two"]}')
      expect(JSON.parse(readFileSync(backupPathFor(file), 'utf-8'))).toEqual({ items: ['one'] })
      expect(existsSync(file + '.tmp')).toBe(false)
    })

    it('never runs two writes at once and coalesces mutations made while a write is running', async () => {
      fsState.writeDelayMs = 20
      const store = make()
      store.load()

      const saves: Promise<void>[] = []
      for (let i = 0; i < 10; i++) {
        store.state.items.push(`item-${i}`)
        saves.push(store.save())
      }
      await Promise.all(saves)

      expect(fsState.maxActive).toBe(1)
      // The first write starts at once; everything made during it lands in one second write.
      expect(fsState.writes.length).toBeLessThanOrEqual(2)
      expect(JSON.parse(readFileSync(file, 'utf-8')).items).toHaveLength(10)
      // The last write holds the final state, so no stale snapshot can win.
      expect(JSON.parse(fsState.writes[fsState.writes.length - 1]).items).toHaveLength(10)
    })

    it('resolves a save only after a write that includes its change finished', async () => {
      fsState.writeDelayMs = 15
      const store = make()
      store.load()

      store.state.items.push('first')
      const first = store.save()
      store.state.items.push('second') // made while the first write is in flight
      const second = store.save()

      await first
      await second
      expect(JSON.parse(readFileSync(file, 'utf-8')).items).toEqual(['first', 'second'])
    })

    it('reports a failed write to the caller and retries on the next save', async () => {
      const store = make()
      store.load()
      store.state.items.push('x')
      fsState.failNext = true

      await expect(store.save()).rejects.toThrow('disk full')
      expect(store.hasUnsavedChanges).toBe(true)

      await store.save()
      expect(store.hasUnsavedChanges).toBe(false)
      expect(JSON.parse(readFileSync(file, 'utf-8')).items).toEqual(['x'])
    })

    it('lets the write queued behind a failed write still run', async () => {
      fsState.writeDelayMs = 10
      const store = make()
      store.load()
      store.state.items.push('x')
      fsState.failNext = true
      const failed = store.save()
      await new Promise((r) => setTimeout(r, 2)) // the first write is now in flight
      store.state.items.push('y')
      const trailing = store.save()

      await expect(failed).rejects.toThrow('disk full')
      // A failed write must not poison the chain for the writes behind it.
      await expect(trailing).resolves.toBeUndefined()
      expect(JSON.parse(readFileSync(file, 'utf-8')).items).toEqual(['x', 'y'])
    })
  })

  describe('flush', () => {
    it('resolves immediately when nothing is unsaved', async () => {
      const store = make()
      store.load()
      await store.flush()
      expect(fsState.writes).toHaveLength(0)
    })

    it('waits for the in-flight write and writes the latest state', async () => {
      fsState.writeDelayMs = 10
      const store = make()
      store.load()
      store.state.items.push('a')
      void store.save().catch(() => {})
      store.state.items.push('b')
      store.markDirty() // mutated without an explicit save, as the cache does in a hurry

      await store.flush()
      expect(store.hasUnsavedChanges).toBe(false)
      expect(JSON.parse(readFileSync(file, 'utf-8')).items).toEqual(['a', 'b'])
    })
  })

  describe('saveSync', () => {
    it('writes before returning, for small rarely written files', () => {
      const store = make()
      store.load()
      store.state.items.push('sync')
      store.saveSync()
      expect(JSON.parse(readFileSync(file, 'utf-8')).items).toEqual(['sync'])
      expect(store.hasUnsavedChanges).toBe(false)
    })
  })
})
