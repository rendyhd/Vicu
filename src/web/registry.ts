import type { Handle, HandlerEvent } from '../main/handlers/types'

// The web host's side of `window.api`: where the handlers the desktop registers with `ipcMain`
// are kept, and how the page calls them. An argument or an answer is copied on the way, as IPC
// copies it, so the page and the handlers never share an object.

type Listener = (event: HandlerEvent, ...args: any[]) => unknown

const handlers = new Map<string, Listener>()

/** The one "window" of a tab. */
const EVENT: HandlerEvent = { sender: { id: 1 } }

/** Register one channel (the web host's `handleTrusted`). */
export const handle: Handle = (channel, listener) => {
  if (handlers.has(channel)) throw new Error(`The channel "${channel}" is registered twice`)
  handlers.set(channel, listener)
}

function copy<T>(value: T): T {
  if (value === undefined || value === null) return value
  try {
    return structuredClone(value)
  } catch {
    return value
  }
}

/** Said when the page calls a channel the web version does not have (see unavailable.ts). */
export class NotInBrowserError extends Error {
  constructor(readonly channel: string) {
    super(`"${channel}" is not available in the browser`)
    this.name = 'NotInBrowserError'
  }
}

/** Call a channel, as `ipcRenderer.invoke` does. */
export async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const listener = handlers.get(channel)
  if (!listener) throw new NotInBrowserError(channel)
  return copy(await listener(EVENT, ...copy(args)))
}

export function isHandled(channel: string): boolean {
  return handlers.has(channel)
}

export function handledChannels(): string[] {
  return [...handlers.keys()].sort()
}
