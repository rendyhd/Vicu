// `@host/windows`, the web side. On the desktop a change is sent to every window over IPC; here
// the page is the only "window" of its tab, so the message goes to the listeners `window.api`
// registered (src/web/registry.ts wires `on` to `listen`). Other tabs learn of a change through the
// stored documents (host/storage.ts) and src/web/tabs.ts.

type Listener = (...args: unknown[]) => void

const listeners = new Map<string, Set<Listener>>()

/** Listen to a channel; returns the unsubscribe. */
export function listen(channel: string, listener: Listener): () => void {
  let set = listeners.get(channel)
  if (!set) {
    set = new Set()
    listeners.set(channel, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
  }
}

/**
 * Tell the page something changed. Delivered in a later microtask with a copy of the payload, as
 * an IPC message would be: the sender never runs page code in the middle of its own work, and the
 * page cannot change the sender's objects.
 */
export function sendToAllWindows(channel: string, ...args: unknown[]): void {
  const set = listeners.get(channel)
  if (!set || set.size === 0) return
  let copy: unknown[]
  try {
    copy = structuredClone(args)
  } catch {
    copy = args
  }
  queueMicrotask(() => {
    for (const listener of [...set]) {
      try {
        listener(...copy)
      } catch (err) {
        console.error(`[vicu] a listener of "${channel}" failed:`, err)
      }
    }
  })
}
