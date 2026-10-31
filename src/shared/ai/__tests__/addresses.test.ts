import { describe, expect, it } from 'vitest'
import { AI_LIMITS, AI_MESSAGES } from '../contract'
import {
  DEFAULT_AI_SETTINGS,
  choosingProvider,
  featureProblem,
  keyId,
  mayLackVersionPath,
  normaliseAiSettings,
  savedAddressesOf,
  savingAddress,
  withSavedModels,
  withoutSavedAddress,
} from '../settings'
import type { AiSettings } from '../types'
import { aiFixture } from './fixture'

// Typed addresses, what each preset remembers and saved addresses (docs/ai-assistant-v1.md 2.4, 7.2).

const other = (address: string, model = 'm'): AiSettings => ({
  ...DEFAULT_AI_SETTINGS,
  provider: 'other',
  address,
  models: { dictation: model, ask: model },
})

describe('a typed address without its version path (2.4)', () => {
  it('follows the addressVersion cases of the fixture', () => {
    const cases = aiFixture.addressVersion.cases as Array<{ address: string; hint: boolean }>
    expect(cases.length).toBeGreaterThanOrEqual(10)
    for (const c of cases) expect(mayLackVersionPath(c.address), c.address).toBe(c.hint)
  })

  it('adds the hint to the reason a feature cannot run', () => {
    const result = {
      models: { ok: false, count: 0, error: 'The provider answered 404.' },
      structured: { ok: false, mode: null, error: 'The provider answered 404.' },
      tool: { ok: false, error: 'The provider answered 404.' },
      features: { dictation: false, ask: false, talk: false },
      hint: AI_MESSAGES.addressVersionHint,
    }
    expect(featureProblem('dictation', result)).toBe(`The provider answered 404. ${AI_MESSAGES.addressVersionHint}`)
  })
})

describe('what each preset remembers (7.2)', () => {
  it('brings back the address and models of a preset chosen again', () => {
    const start = { ...other('http://box:1234/v1', 'llama'), models: { dictation: 'llama', ask: 'qwen' }, features: { dictation: false, ask: true, talk: false } }
    const away = choosingProvider(start, 'openai')
    expect(away.address).toBe('https://api.openai.com/v1')
    expect(away.features.ask).toBe(false)

    const back = choosingProvider({ ...away, models: { dictation: 'gpt-x', ask: 'gpt-x' } }, 'other')
    expect(back.address).toBe('http://box:1234/v1')
    expect(back.models).toEqual({ dictation: 'llama', ask: 'qwen' })
    expect(back.remembered.openai?.models.dictation).toBe('gpt-x')
    expect(back.remembered.other).toBeUndefined()
  })

  it('remembers through Off as well', () => {
    const off = choosingProvider(other('http://box/v1'), null)
    expect(off.provider).toBeNull()
    expect(choosingProvider(off, 'other').address).toBe('http://box/v1')
  })

  it('keeps the fixture address of a fixed preset', () => {
    const s = choosingProvider({ ...DEFAULT_AI_SETTINGS, remembered: { openai: { address: 'https://old.example/v1', models: { dictation: 'm', ask: 'm' } } } }, 'openai')
    expect(s.address).toBe('https://api.openai.com/v1')
    expect(s.models.dictation).toBe('m')
  })

  it('survives a round trip through the normaliser', () => {
    const s = savingAddress(choosingProvider(choosingProvider(other('http://box/v1'), 'openai'), 'ollama'))
    expect(normaliseAiSettings(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })
})

describe('saved addresses (7.2)', () => {
  it('keeps the latest first, once each, at most saved_addresses_max', () => {
    let s = other('')
    for (let n = 1; n <= 7; n++) s = savingAddress({ ...s, address: `http://box${n}/v1` })
    s = savingAddress({ ...s, address: 'http://box5/v1' })
    const addresses = savedAddressesOf(s).map((e) => e.address)
    expect(addresses).toHaveLength(AI_LIMITS.saved_addresses_max)
    expect(addresses[0]).toBe('http://box5/v1')
    expect(addresses.filter((a) => a === 'http://box5/v1')).toHaveLength(1)
    expect(addresses).not.toContain('http://box1/v1')
  })

  it('saves a typed preset default address too, and never a fixed preset', () => {
    const ollama = savingAddress(choosingProvider(DEFAULT_AI_SETTINGS, 'ollama'))
    expect(savedAddressesOf(ollama).map((e) => e.address)).toEqual(['http://localhost:11434/v1'])
    expect(savedAddressesOf(savingAddress(choosingProvider(DEFAULT_AI_SETTINGS, 'openai')))).toEqual([])
  })

  it('lets the saved entry follow a model change', () => {
    const s = savingAddress(other('http://box/v1', 'a'))
    expect(savedAddressesOf(withSavedModels({ ...s, models: { dictation: 'b', ask: 'b' } }))[0].models.dictation).toBe('b')
  })

  it('never removes the address in use', () => {
    const s = savingAddress({ ...savingAddress(other('http://a/v1')), address: 'http://b/v1' })
    expect(savedAddressesOf(withoutSavedAddress(s, 'http://b/v1'))).toHaveLength(2)
    expect(savedAddressesOf(withoutSavedAddress(s, 'http://a/v1')).map((e) => e.address)).toEqual(['http://b/v1'])
  })
})

describe('keys per preset and typed address (7.2)', () => {
  it('stores a fixed preset key per preset and a typed one per address', () => {
    expect(keyId({ provider: 'openai', address: '' })).toBe('openai')
    expect(keyId({ provider: 'other', address: 'http://box/v1/' })).toBe('other|http://box/v1')
    expect(keyId({ provider: 'ollama', address: '' })).toBe('ollama|http://localhost:11434/v1')
    expect(keyId({ provider: null, address: '' })).toBeNull()
  })
})
