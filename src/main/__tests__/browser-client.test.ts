import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'vicu-browser-'))
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

import { getBrowserContext } from '../browser-client'

function write(data: unknown): void {
  writeFileSync(join(dir, 'browser-context.json'), JSON.stringify(data))
}

describe('getBrowserContext', () => {
  it('accepts a recent context', () => {
    write({ url: 'https://example.com', title: 'Example', timestamp: Date.now() })
    expect(getBrowserContext()?.url).toBe('https://example.com')
  })
  it('rejects an old one', () => {
    write({ url: 'https://example.com', timestamp: Date.now() - 60_000 })
    expect(getBrowserContext()).toBeNull()
  })
  it('does not treat a context without a numeric timestamp as fresh', () => {
    write({ url: 'https://example.com' })
    expect(getBrowserContext()).toBeNull()
    write({ url: 'https://example.com', timestamp: '123' })
    expect(getBrowserContext()).toBeNull()
  })
})
