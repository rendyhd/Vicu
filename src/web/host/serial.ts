// `@host/serial`, the web side. Every tab runs its own copy of the write gate
// (src/main/offline/task-writes.ts), which sends one write at a time because Vikunja's default
// SQLite database answers parallel writes with "database is locked". A Web Lock extends that
// across the tabs of one browser.

const WRITE_LOCK = 'vicu-web-writes'

/** Run one write to the server after the writes of every other tab that asked earlier. */
export function oneWriterAtATime<T>(send: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return send()
  return navigator.locks.request(WRITE_LOCK, send) as Promise<T>
}
