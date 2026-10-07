import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { classifySecretStorage } from '../auth/secret-storage'

describe('classifySecretStorage', () => {
  it('is encrypted when the OS keychain is in use', () => {
    expect(classifySecretStorage({ encryptionAvailable: true, platform: 'win32', hasPlainSecrets: false })).toBe('encrypted')
    expect(classifySecretStorage({ encryptionAvailable: true, platform: 'darwin', hasPlainSecrets: false })).toBe('encrypted')
    expect(classifySecretStorage({ encryptionAvailable: true, platform: 'linux', backend: 'gnome_libsecret', hasPlainSecrets: false })).toBe('encrypted')
    expect(classifySecretStorage({ encryptionAvailable: true, platform: 'linux', backend: 'kwallet6', hasPlainSecrets: false })).toBe('encrypted')
  })

  it('is plaintext when encryption is unavailable, on any platform', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      expect(classifySecretStorage({ encryptionAvailable: false, platform, hasPlainSecrets: false })).toBe('plaintext')
    }
  })

  it('is plaintext when a stored secret was written without encryption, even if encryption works now', () => {
    expect(classifySecretStorage({ encryptionAvailable: true, platform: 'win32', hasPlainSecrets: true })).toBe('plaintext')
  })

  it('is obfuscated, not encrypted, on Linux with the basic text backend', () => {
    expect(classifySecretStorage({ encryptionAvailable: true, platform: 'linux', backend: 'basic_text', hasPlainSecrets: false })).toBe('obfuscated')
  })

  it('does not call an unknown Linux backend encrypted', () => {
    expect(classifySecretStorage({ encryptionAvailable: true, platform: 'linux', backend: 'unknown', hasPlainSecrets: false })).toBe('obfuscated')
    expect(classifySecretStorage({ encryptionAvailable: true, platform: 'linux', hasPlainSecrets: false })).toBe('obfuscated')
  })

  it('ignores the backend name off Linux', () => {
    expect(classifySecretStorage({ encryptionAvailable: true, platform: 'win32', backend: 'basic_text', hasPlainSecrets: false })).toBe('encrypted')
  })
})

const state = vi.hoisted(() => ({
  dir: '',
  available: true,
  backend: undefined as string | undefined,
  throwOnAvailable: false,
}))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: {
    isEncryptionAvailable: () => {
      if (state.throwOnAvailable) throw new Error('not ready')
      return state.available
    },
    getSelectedStorageBackend: () => state.backend,
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (buffer: Buffer) => buffer.toString('utf-8').slice(4),
  },
}))

async function loadStore() {
  vi.resetModules()
  return await import('../auth/token-store')
}

describe('token store secret storage status', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-secret-storage-'))
    state.available = true
    state.backend = undefined
    state.throwOnAvailable = false
  })

  afterEach(() => {
    rmSync(state.dir, { recursive: true, force: true })
  })

  it('reports encrypted after a token is stored with a working keychain', async () => {
    const store = await loadStore()
    store.storeAPIToken('tk_secret', 4102444800)
    const onDisk = JSON.parse(readFileSync(join(state.dir, 'auth.json'), 'utf8')) as { api_token: string }
    expect(onDisk.api_token.startsWith('plain:')).toBe(false)
    expect(onDisk.api_token).not.toContain('tk_secret')
    expect(store.getSecretStorageStatus('win32')).toBe('encrypted')
    expect(store.getSecretStorageStatus('darwin')).toBe('encrypted')
  })

  it('reports plaintext, and says so on disk, when encryption is unavailable', async () => {
    state.available = false
    const store = await loadStore()
    store.storeAPIToken('tk_secret', 4102444800)
    const onDisk = JSON.parse(readFileSync(join(state.dir, 'auth.json'), 'utf8')) as { api_token: string }
    expect(onDisk.api_token).toBe('plain:tk_secret')
    expect(store.getSecretStorageStatus('win32')).toBe('plaintext')
    expect(store.getSecretStorageStatus('darwin')).toBe('plaintext')
  })

  it('keeps reporting plaintext for secrets written plain even after the keychain works again', async () => {
    state.available = false
    const store = await loadStore()
    store.storeJWT('a.b.c')
    state.available = true
    expect(store.getSecretStorageStatus('win32')).toBe('plaintext')
  })

  it('treats a throwing availability check as unavailable', async () => {
    state.throwOnAvailable = true
    const store = await loadStore()
    expect(store.getSecretStorageStatus('win32')).toBe('plaintext')
  })

  it('reports obfuscated on Linux with the basic backend', async () => {
    state.backend = 'basic_text'
    const store = await loadStore()
    store.storeAPIToken('tk_secret', 4102444800)
    expect(store.getSecretStorageStatus('linux')).toBe('obfuscated')
  })

  it('reports the real state when nothing is stored yet', async () => {
    const store = await loadStore()
    expect(store.getSecretStorageStatus('win32')).toBe('encrypted')
    state.available = false
    expect(store.getSecretStorageStatus('win32')).toBe('plaintext')
  })
})
