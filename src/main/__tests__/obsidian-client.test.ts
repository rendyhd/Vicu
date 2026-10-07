import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Local REST API stand-in: records every request and answers GET /active/ with a note that
// has no uid, so any write would be visible as a PATCH.
const requests: Array<{ method: string; path: string; body: string }> = []
let activeNote: { path: string; content: string; frontmatter: Record<string, unknown>; stat: object } = {
  path: 'Projects/Plan.md',
  content: '',
  frontmatter: {},
  stat: {},
}

vi.mock('node:https', () => {
  class Agent {}
  const request = (options: { method: string; path: string }, callback: (res: EventEmitter & { statusCode: number }) => void) => {
    const record = { method: options.method, path: options.path, body: '' }
    requests.push(record)
    const req = new EventEmitter() as EventEmitter & { write(chunk: string): void; end(): void }
    req.write = (chunk: string) => { record.body += chunk }
    req.end = () => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number }
      res.statusCode = 200
      callback(res)
      queueMicrotask(() => {
        const payload = options.method === 'GET' ? JSON.stringify(activeNote) : '{}'
        res.emit('data', Buffer.from(payload))
        res.emit('end')
      })
    }
    return req
  }
  return { Agent, request, default: { Agent, request } }
})

const config = {
  obsidian_mode: 'ask' as 'off' | 'ask' | 'always',
  obsidian_api_key: 'key',
  obsidian_port: 27124,
  obsidian_vault_name: 'Vault',
}
vi.mock('../config', () => ({ loadConfig: () => config }))

import {
  getObsidianContext,
  rememberShownObsidianContext,
  resolveShownObsidianLink,
} from '../obsidian-client'

beforeEach(() => {
  requests.length = 0
  activeNote = { path: 'Projects/Plan.md', content: '', frontmatter: {}, stat: {} }
  config.obsidian_mode = 'ask'
  rememberShownObsidianContext(null)
})

describe('getObsidianContext', () => {
  it('only reads: opening Quick Entry over a note never writes a uid', async () => {
    const ctx = await getObsidianContext()
    expect(ctx).not.toBeNull()
    expect(ctx!.isUidBased).toBe(false)
    expect(ctx!.deepLink).toBe('obsidian://open?vault=Vault&file=Projects%2FPlan')
    expect(requests.map((r) => r.method)).toEqual(['GET'])
  })

  it('also does not write in always mode', async () => {
    config.obsidian_mode = 'always'
    await getObsidianContext()
    expect(requests.every((r) => r.method === 'GET')).toBe(true)
  })

  it('does nothing when the integration is off', async () => {
    config.obsidian_mode = 'off'
    expect(await getObsidianContext()).toBeNull()
    expect(requests).toHaveLength(0)
  })
})

describe('resolveShownObsidianLink', () => {
  it('returns null when no context was shown, and does not call Obsidian', async () => {
    expect(await resolveShownObsidianLink()).toBeNull()
    expect(requests).toHaveLength(0)
  })

  it('writes the uid with one PATCH when a task is saved with the note linked', async () => {
    rememberShownObsidianContext((await getObsidianContext())!)
    requests.length = 0

    const resolved = await resolveShownObsidianLink()

    expect(resolved!.isUidBased).toBe(true)
    expect(resolved!.deepLink).toMatch(/^obsidian:\/\/advanced-uri\?vault=Vault&uid=[0-9a-f-]{36}$/)
    const patches = requests.filter((r) => r.method === 'PATCH')
    expect(patches).toHaveLength(1)
    expect(patches[0].path).toBe('/active/')
    expect(JSON.parse(patches[0].body)).toEqual({ frontmatter: { uid: expect.any(String) } })
  })

  it('does not write when the note in front is not the one that was shown', async () => {
    rememberShownObsidianContext((await getObsidianContext())!)
    requests.length = 0
    activeNote = { ...activeNote, path: 'Elsewhere.md' }

    const resolved = await resolveShownObsidianLink()

    expect(resolved!.isUidBased).toBe(false)
    expect(requests.map((r) => r.method)).toEqual(['GET'])
  })
})
