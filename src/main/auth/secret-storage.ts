/**
 * How the stored sign-in secrets are protected, decided from facts the token store collects.
 * Free of Electron so it can be tested.
 *
 * - encrypted: the OS keychain (DPAPI, macOS Keychain, libsecret or KWallet) protects them.
 * - obfuscated: Linux "basic" backend. Chromium's safeStorage reports encryption as available
 *   there, but the key is a constant, so it only obscures the value.
 * - plaintext: safeStorage is unavailable (or a secret was stored while it was), so the value is
 *   in auth.json as written.
 */
export type SecretStorageLevel = 'encrypted' | 'obfuscated' | 'plaintext'

export interface SecretStorageFacts {
  /** safeStorage.isEncryptionAvailable(); false when it threw. */
  encryptionAvailable: boolean
  platform: NodeJS.Platform
  /** safeStorage.getSelectedStorageBackend(), Linux only. */
  backend?: string
  /** A stored secret carries the plain: prefix, so it was written without encryption. */
  hasPlainSecrets: boolean
}

export function classifySecretStorage(facts: SecretStorageFacts): SecretStorageLevel {
  if (!facts.encryptionAvailable || facts.hasPlainSecrets) return 'plaintext'
  if (facts.platform === 'linux') {
    const backend = facts.backend
    if (!backend || backend === 'basic_text' || backend === 'unknown') return 'obfuscated'
  }
  return 'encrypted'
}
