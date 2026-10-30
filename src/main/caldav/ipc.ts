import { handleTrusted } from '../secure-ipc'
import type { CalDavCalendar, CalDavConnectionInput, CalDavEventUpdate } from '../../shared/caldav-types'
import { connections } from './store'
import { discover, events, publicError, remove, select, update } from './service'

// Serialize operations so discovery/removal and a write cannot race a changed connection.
let tail: Promise<unknown> = Promise.resolve()
function run<T>(operation: () => T | Promise<T>): Promise<T> {
  const next = tail.then(operation).catch((error: unknown) => { throw new Error(publicError(error)) })
  tail = next.catch(() => {})
  return next
}

export function registerCalDavIpc(): void {
  handleTrusted('caldav:connections', () => run(connections))
  handleTrusted('caldav:discover', (_event, input: CalDavConnectionInput) => run(() => discover(input)))
  handleTrusted('caldav:select', (_event, id: string, calendars: CalDavCalendar[]) => run(() => select(id, calendars)))
  handleTrusted('caldav:remove', (_event, id: string) => run(() => remove(id)))
  handleTrusted('caldav:events', (_event, start: string, end: string) => run(() => events(start, end)))
  handleTrusted('caldav:update', (_event, input: CalDavEventUpdate) => run(() => update(input)))
}
