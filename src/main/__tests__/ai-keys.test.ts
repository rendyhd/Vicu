import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const state = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  // The plaintext fallback: no OS keychain in tests.
  safeStorage: { isEncryptionAvailable: () => false },
}))

async function loadStore() {
  vi.resetModules()
  return await import('../ai/settings-store')
}

// The provider keys (docs/ai-assistant-v1.md 7.2): per preset, and per address for a typed preset.
describe('AI keys', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-ai-keys-'))
  })

  afterEach(() => {
    rmSync(state.dir, { recursive: true, force: true })
  })

  it('moves the one key of an older version to the preset and address in use, once', async () => {
    writeFileSync(join(state.dir, 'ai-settings.json'), JSON.stringify({ provider: 'other', address: 'http://box/v1' }))
    writeFileSync(join(state.dir, 'ai-key.json'), JSON.stringify({ key: 'plain:sk-old' }))
    const store = await loadStore()
    expect(store.getProviderKey()).toBe('sk-old')
    expect(JSON.parse(readFileSync(join(state.dir, 'ai-key.json'), 'utf8'))).toEqual({ keys: { 'other|http://box/v1': 'plain:sk-old' } })
    expect(store.getProviderKey({ provider: 'other', address: 'http://elsewhere/v1' })).toBeNull()
    expect(store.getProviderKey({ provider: 'openai', address: '' })).toBeNull()
  })

  it('keeps a key per preset when switching', async () => {
    const store = await loadStore()
    await store.chooseAiProvider('openai')
    store.setProviderKey('sk-openai')
    await store.chooseAiProvider('anthropic')
    expect(store.getProviderKey()).toBeNull()
    store.setProviderKey('sk-ant')
    await store.chooseAiProvider('openai')
    expect(store.getProviderKey()).toBe('sk-openai')
  })

  it('brings back the Other address after another preset (#68)', async () => {
    const store = await loadStore()
    await store.chooseAiProvider('other')
    await store.saveTypedAddress('http://box:1234/v1', true)
    await store.chooseAiProvider('openai')
    await store.chooseAiProvider('other')
    expect(store.getAiSettings().address).toBe('http://box:1234/v1')
  })

  it('takes the key along when an address is edited, not when one is added', async () => {
    const store = await loadStore()
    await store.chooseAiProvider('other')
    await store.saveTypedAddress('http://box:1234', true)
    store.setProviderKey('sk-box')
    await store.saveTypedAddress('http://box:1234/v1', true)
    expect(store.getProviderKey()).toBe('sk-box')
    expect(store.getProviderKey({ provider: 'other', address: 'http://box:1234' })).toBeNull()
    expect(store.getAiSettings().savedAddresses.other?.map((e) => e.address)).toEqual(['http://box:1234/v1'])

    await store.saveTypedAddress('http://second/v1', false)
    expect(store.getProviderKey()).toBeNull()
    expect(store.getAiSettings().savedAddresses.other?.map((e) => e.address)).toEqual(['http://second/v1', 'http://box:1234/v1'])

    await store.useSavedAddress('http://box:1234/v1')
    expect(store.getProviderKey()).toBe('sk-box')
    await store.removeSavedAddress('http://second/v1')
    expect(store.getProviderKey({ provider: 'other', address: 'http://second/v1' })).toBeNull()
    expect(store.getAiSettings().savedAddresses.other?.map((e) => e.address)).toEqual(['http://box:1234/v1'])
  })
})
