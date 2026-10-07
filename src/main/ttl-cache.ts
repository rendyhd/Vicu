/** A small cache whose entries expire `ttlMs` after they were set. */
export interface TtlCache<K, V> {
  get(key: K): V | undefined
  set(key: K, value: V): void
  delete(key: K): void
  clear(): void
}

export function createTtlCache<K, V>(ttlMs: number, now: () => number = Date.now): TtlCache<K, V> {
  const entries = new Map<K, { value: V; expiresAt: number }>()
  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      if (now() >= entry.expiresAt) {
        entries.delete(key)
        return undefined
      }
      return entry.value
    },
    set(key, value) {
      entries.set(key, { value, expiresAt: now() + ttlMs })
    },
    delete(key) {
      entries.delete(key)
    },
    clear() {
      entries.clear()
    },
  }
}
