// `@host/serial`, the Electron side. The main process is the only one that writes to the server,
// and offline/task-writes.ts already sends its writes one at a time, so there is nothing to add.
// The web build swaps this module for src/web/host/serial.ts, where every tab is a writer.

/** Run one write to the server; on the desktop, at once. */
export function oneWriterAtATime<T>(send: () => Promise<T>): Promise<T> {
  return send()
}
