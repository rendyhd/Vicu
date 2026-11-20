import {
  createDocumentCarrierIdStore,
  emptyCarrierIdFile,
  parseCarrierIdFile,
  type CarrierIdFile,
  type CarrierIdStore,
} from '../../main/carrier-discovery'

// `@host/storage`, the web side: the documents the desktop keeps as files in its user data folder
// (config.json, carrier-ids.json) live in this browser's IndexedDB.
//
// The main-process code reads its config synchronously, so every document is loaded into memory
// once, before anything else starts (`initStorage`), and a write goes to memory first and to
// IndexedDB behind it, which is how the desktop's JsonFileStore works too. Another tab that writes
// a document says so on a BroadcastChannel; this tab then holds the new text and tells whoever
// asked to hear of it (`onDocumentChangedElsewhere`).

const DB_NAME = 'vicu-web'
const STORE = 'documents'
const CHANNEL = 'vicu-web-documents'

export const CONFIG_DOCUMENT = 'config'
export const CARRIER_IDS_DOCUMENT = 'carrier-ids'

const documents = new Map<string, string>()
const elsewhere = new Set<(name: string) => void>()
let db: IDBDatabase | null = null
let channel: BroadcastChannel | null = null

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'))
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'))
  })
}

function readAll(database: IDBDatabase): Promise<Array<[string, string]>> {
  return new Promise((resolve, reject) => {
    const entries: Array<[string, string]> = []
    const cursor = database.transaction(STORE, 'readonly').objectStore(STORE).openCursor()
    cursor.onsuccess = () => {
      const at = cursor.result
      if (!at) return resolve(entries)
      if (typeof at.key === 'string' && typeof at.value === 'string') entries.push([at.key, at.value])
      at.continue()
    }
    cursor.onerror = () => reject(cursor.error ?? new Error('IndexedDB could not be read'))
  })
}

/**
 * Load every stored document. Without IndexedDB (some private windows) the app still runs, with
 * its settings kept for this tab only; the console says so.
 */
export async function initStorage(): Promise<void> {
  try {
    db = await openDatabase()
    for (const [name, text] of await readAll(db)) documents.set(name, text)
  } catch (err) {
    db = null
    console.warn('[vicu] settings are kept for this tab only:', err instanceof Error ? err.message : err)
  }
  if (typeof BroadcastChannel === 'function') {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { name?: unknown; text?: unknown } | null
      if (!data || typeof data.name !== 'string') return
      if (typeof data.text === 'string') documents.set(data.name, data.text)
      else documents.delete(data.name)
      for (const listener of [...elsewhere]) listener(data.name)
    }
  }
}

/** A stored document's text, or null. */
export function readDocument(name: string): string | null {
  return documents.get(name) ?? null
}

/** Replace a stored document, or remove it with `null`. Other tabs are told. */
export function writeDocument(name: string, text: string | null): void {
  if (text === null) documents.delete(name)
  else documents.set(name, text)
  if (db) {
    try {
      const transaction = db.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      const request = text === null ? store.delete(name) : store.put(text, name)
      request.onerror = () => console.warn(`[vicu] could not save "${name}":`, request.error?.message)
      const written = new Promise<void>((done) => {
        transaction.oncomplete = () => done()
        transaction.onerror = () => done()
        transaction.onabort = () => done()
      }).finally(() => {
        writing.delete(written)
      })
      writing.add(written)
    } catch (err) {
      console.warn(`[vicu] could not save "${name}":`, err instanceof Error ? err.message : err)
    }
  }
  channel?.postMessage({ name, text })
}

/** The writes that have not reached the browser's storage yet. */
const writing = new Set<Promise<void>>()

/**
 * Wait until everything written so far is stored. Before the page leaves on purpose (an SSO
 * sign-in goes to the provider and comes back), so what was just saved is there on the way back.
 */
export async function flushDocuments(): Promise<void> {
  await Promise.all([...writing])
}

/** Another tab replaced a document; this tab already holds its new text when the listener runs. */
export function onDocumentChangedElsewhere(listener: (name: string) => void): () => void {
  elsewhere.add(listener)
  return () => {
    elsewhere.delete(listener)
  }
}

/** Remove everything this browser stored for Vicu (sign-out on a machine that is not yours). */
export function clearDocuments(): void {
  for (const name of [...documents.keys()]) writeDocument(name, null)
}

/** The stored config, parsed. A text that does not parse reads as no config (and is logged). */
export function readStoredConfig<T>(parse: (raw: string) => T): { value: T; recovered: boolean } | null {
  const raw = readDocument(CONFIG_DOCUMENT)
  if (raw === null) return null
  try {
    return { value: parse(raw), recovered: false }
  } catch (err) {
    console.warn('[vicu] the stored settings could not be read:', err instanceof Error ? err.message : err)
    return null
  }
}

export function writeStoredConfig(json: string): void {
  writeDocument(CONFIG_DOCUMENT, json)
}

/** The remembered carrier ids. */
export function openCarrierIdStore(): CarrierIdStore {
  let state: CarrierIdFile = emptyCarrierIdFile()
  const raw = readDocument(CARRIER_IDS_DOCUMENT)
  if (raw !== null) {
    try {
      state = parseCarrierIdFile(JSON.parse(raw))
    } catch {
      // An unreadable document only costs one discovery pass.
    }
  }
  return createDocumentCarrierIdStore({
    get state() { return state },
    save: () => writeDocument(CARRIER_IDS_DOCUMENT, JSON.stringify(state)),
  })
}
