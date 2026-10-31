import { app, safeStorage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { readFileWithBackup, removeFileAndBackup, writeFileAtomic } from '../atomic-file'
import { JsonFileStore } from '../json-file-store'
import { providerPreset, type ProviderId } from '../../shared/ai/contract'
import {
  DEFAULT_AI_SETTINGS,
  choosingProvider,
  effectiveAddress,
  keyId,
  normaliseAiSettings,
  sameAddress,
  savedAddressesOf,
  savingAddress,
  withSavedModels,
  withoutSavedAddress,
} from '../../shared/ai/settings'
import type { AiSettings, AiSettingsPatch, AiSettingsView } from '../../shared/ai/types'

// The assistant's device settings (docs/ai-assistant-v1.md section 7.2) in userData/ai-settings.json,
// and the provider keys (one per preset, and per address for a typed preset) in userData/ai-key.json, protected like the Vikunja token in auth.json: the
// OS keychain through safeStorage (a `plain:` value only where encryption is unavailable), file mode
// 600. They belong to the device, not the account: signing out keeps them; never in config.json's
// account data, the synced prefs carrier, a backup of the account or a log line.

let store: JsonFileStore<AiSettings> | null = null

function settingsStore(): JsonFileStore<AiSettings> {
  if (!store) {
    store = new JsonFileStore<AiSettings>({
      path: join(app.getPath('userData'), 'ai-settings.json'),
      backup: true,
      label: 'AI settings',
      empty: () => normaliseAiSettings(DEFAULT_AI_SETTINGS),
      parse: (json) => normaliseAiSettings(json),
    })
    store.load()
  }
  return store
}

export function getAiSettings(): AiSettings {
  return settingsStore().state
}

export async function updateAiSettings(change: (current: AiSettings) => AiSettings): Promise<AiSettings> {
  const s = settingsStore()
  s.state = normaliseAiSettings(change(s.state))
  await s.save()
  return s.state
}

export function patchAiSettings(patch: AiSettingsPatch): Promise<AiSettings> {
  return updateAiSettings((current) => withSavedModels({
    ...current,
    ...patch,
    models: { ...current.models, ...(patch.models ?? {}) },
    features: { ...current.features, ...(patch.features ?? {}) },
    speech: { ...current.speech, ...(patch.speech ?? {}) },
  }))
}

/** Another preset, or Off; what it was set to before comes back (7.2). */
export function chooseAiProvider(id: ProviderId | null): Promise<AiSettings> {
  return updateAiSettings((current) => choosingProvider(current, id))
}

/**
 * Save address of a typed preset (7.2). `replacing` (Edit) puts the address in place of the one in
 * use, which takes its key along; otherwise (Add address) it is saved next to it.
 */
export async function saveTypedAddress(address: string, replacing: boolean): Promise<void> {
  const typed = address.trim().replace(/\/+$/, '')
  const before = getAiSettings()
  if (!typed || !before.provider || !providerPreset(before.provider)?.addressEditable) return
  if (sameAddress(effectiveAddress(before), typed)) {
    await updateAiSettings(savingAddress)
    return
  }
  const oldKey = replacing ? getProviderKey(before) : null
  const oldId = keyId(before)
  const now = await updateAiSettings((current) => {
    const provider = current.provider as ProviderId
    const kept = replacing
      ? { ...current, savedAddresses: { ...current.savedAddresses, [provider]: savedAddressesOf(current).filter((e) => !sameAddress(e.address, effectiveAddress(current))) } }
      : savingAddress(current)
    return savingAddress({ ...kept, address: typed })
  })
  if (replacing) {
    if (oldKey && getProviderKey(now) === null) setProviderKey(oldKey, now)
    if (oldId) forgetProviderKey(oldId)
  }
}

/** A saved address of the preset in use, with the models and key it was used with. */
export function useSavedAddress(address: string): Promise<AiSettings> {
  return updateAiSettings((current) => {
    const entry = savedAddressesOf(current).find((e) => sameAddress(e.address, address))
    if (!entry) return current
    const kept = withSavedModels(current)
    return savingAddress({
      ...kept,
      address: entry.address,
      models: { dictation: entry.models.dictation || kept.models.dictation, ask: entry.models.ask || kept.models.ask },
    })
  })
}

/** Forgets a saved address and its key; the address in use stays. */
export async function removeSavedAddress(address: string): Promise<void> {
  const current = getAiSettings()
  if (!current.provider || sameAddress(address, effectiveAddress(current))) return
  await updateAiSettings((s) => withoutSavedAddress(s, address))
  const id = keyId({ provider: current.provider, address })
  if (id) forgetProviderKey(id)
}

export function aiSettingsView(): AiSettingsView {
  return { ...getAiSettings(), hasKey: getProviderKey() !== null }
}

export async function flushAiSettings(): Promise<void> {
  await store?.flush()
}

// --- The keys -----------------------------------------------------------------------------

const PLAIN_PREFIX = 'plain:'
/** A key saved before keys were per preset while no preset was in use: the next preset used takes it (7.2). */
const UNCLAIMED_KEY = '*'
let keyMemory: { path: string; keys: Record<string, string> } | null = null

function keyPath(): string {
  return join(app.getPath('userData'), 'ai-key.json')
}

function encrypt(value: string): string {
  try {
    if (!safeStorage.isEncryptionAvailable()) return PLAIN_PREFIX + value
    return safeStorage.encryptString(value).toString('base64')
  } catch {
    return PLAIN_PREFIX + value
  }
}

function decrypt(encoded: string): string | null {
  if (encoded.startsWith(PLAIN_PREFIX)) return encoded.slice(PLAIN_PREFIX.length)
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  } catch {
    console.warn('[AI] The saved provider key could not be decrypted.')
    return null
  }
}

/** Every stored key by id (`keyId`). Read from disk once and kept in memory. */
function readKeys(): Record<string, string> {
  const path = keyPath()
  if (keyMemory && keyMemory.path === path) return keyMemory.keys
  const keys: Record<string, string> = {}
  if (existsSync(path)) {
    const result = readFileWithBackup(path, (raw) => JSON.parse(raw) as { key?: unknown; keys?: unknown })
    const stored = result?.value
    if (stored && typeof stored.keys === 'object' && stored.keys !== null) {
      for (const [id, encoded] of Object.entries(stored.keys as Record<string, unknown>)) {
        const key = typeof encoded === 'string' ? decrypt(encoded) : null
        if (key) keys[id] = key
      }
    } else if (stored && typeof stored.key === 'string') {
      // One key for every preset, from before keys were kept per preset: it moves to the preset
      // (and typed address) in use, once.
      const key = decrypt(stored.key)
      if (key) keys[keyId(getAiSettings()) ?? UNCLAIMED_KEY] = key
      writeKeys(keys)
    }
  }
  keyMemory = { path, keys }
  return keys
}

function writeKeys(keys: Record<string, string>): void {
  const path = keyPath()
  if (Object.keys(keys).length === 0) {
    removeFileAndBackup(path)
  } else {
    const encoded = Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, encrypt(key)]))
    writeFileAtomic(path, JSON.stringify({ keys: encoded }), { backup: true, mode: 0o600 })
  }
  keyMemory = { path, keys }
}

/** The key of the preset and, when typed, the address of `settings` (the ones in use by default), or null. */
export function getProviderKey(settings: Pick<AiSettings, 'provider' | 'address'> = getAiSettings()): string | null {
  const id = keyId(settings)
  if (!id) return null
  const keys = readKeys()
  if (keys[id] !== undefined) return keys[id]
  const unclaimed = keys[UNCLAIMED_KEY]
  if (unclaimed === undefined) return null
  const next = { ...keys, [id]: unclaimed }
  delete next[UNCLAIMED_KEY]
  writeKeys(next)
  return unclaimed
}

/** Saves the key of the preset and address of `settings` (or removes it with null or an empty string). */
export function setProviderKey(key: string | null, settings: Pick<AiSettings, 'provider' | 'address'> = getAiSettings()): void {
  const id = keyId(settings)
  if (!id) return
  const value = key?.trim() ?? ''
  const next = { ...readKeys() }
  if (value === '') delete next[id]
  else next[id] = value
  writeKeys(next)
}

/** Removes the key stored under `id`. */
export function forgetProviderKey(id: string): void {
  const keys = readKeys()
  if (keys[id] === undefined) return
  const next = { ...keys }
  delete next[id]
  writeKeys(next)
}
