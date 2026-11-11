// The main process's side of the macOS calendar helper (native/calendar-macos/VicuCalendar.swift):
// one helper process at a time, requests and answers as JSON lines with an id, and the change
// notices of `watch`. Free of Electron and of real processes: `spawn` hands back the part of a
// ChildProcess this uses, so the tests drive it with a fake helper (a Node script).
//
// - Started on the first request; without a watch it exits after `idleMs` with nothing to do
//   (closing stdin is how it is told to go, and how it goes when the app does).
// - While watched it stays, and a helper that stops is started again after a pause (5 s, then
//   longer), with one change notice once it watches again so nothing changed meanwhile is missed.
// - Every failure is a CalendarReadError with a sentence that can be shown.

import type { EventKitAccess } from '../../shared/calendar-eventkit'
import { EVENTKIT_DENIED_MESSAGE } from '../../shared/calendar-eventkit'
import { createLineSplitter } from '../voice/helper-protocol'
import { CalendarReadError } from './http'

export interface HelperChild {
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null
  stderr?: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null
  stdin: { write(data: string): unknown; end(): unknown; on?(event: 'error', listener: (err: Error) => void): unknown } | null
  on(event: 'exit', listener: (code: number | null) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  kill(): unknown
}

export interface HelperCalendar {
  id: string
  title: string
  color?: string
  /** The account: "iCloud", "Google", "On My Mac". */
  source?: string
  sourceType?: string
  /** local, caldav, exchange, subscription, birthday. */
  type?: string
}

export interface HelperEvent {
  /** The event's identifier and the occurrence's original start: unique per occurrence. */
  key: string
  calendarId: string
  title: string
  location?: string
  /** ms */
  start: number
  end: number
  allDay: boolean
  /** busy | free | tentative | unavailable | not-supported */
  availability: string
  /** none | confirmed | tentative | canceled */
  status: string
  /** The user's own participant status, when the user is an attendee. */
  self?: string
}

export interface HelperEvents {
  events: HelperEvent[]
  /** Calendar ids the Mac no longer has. */
  missing: string[]
  truncated: boolean
}

export interface EventKitHelperOptions {
  /** Start the helper; throws when it cannot (the binary is missing). */
  spawn: () => HelperChild
  requestTimeoutMs?: number
  /** How long the permission question may wait for the user. */
  permissionTimeoutMs?: number
  idleMs?: number
  /** Pauses before a watched helper that stopped is started again (RESTART_DELAYS_MS). */
  restartDelaysMs?: readonly number[]
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

const REQUEST_TIMEOUT_MS = 30_000
const PERMISSION_TIMEOUT_MS = 10 * 60_000
const IDLE_MS = 60_000
/** Pauses before a watched helper that stopped is started again. */
export const RESTART_DELAYS_MS = [5_000, 30_000, 120_000, 600_000]

const ACCESS = new Set<EventKitAccess>(['full', 'write-only', 'denied', 'restricted', 'not-determined', 'unknown'])

export function accessOf(value: unknown): EventKitAccess {
  return typeof value === 'string' && ACCESS.has(value as EventKitAccess) ? (value as EventKitAccess) : 'unknown'
}

const STOPPED_MESSAGE = 'The calendars of this Mac could not be read: the calendar helper stopped.'

interface Pending {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: unknown
}

interface Running {
  child: HelperChild
  pending: Map<number, Pending>
  closing: boolean
  watchSent: boolean
}

export class EventKitHelper {
  private running: Running | null = null
  private nextId = 1
  private idleTimer: unknown = null
  private restartTimer: unknown = null
  private restarts = 0
  private onChanged: (() => void) | null = null
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(private readonly options: EventKitHelperOptions) {
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  async status(): Promise<EventKitAccess> {
    return accessOf((await this.call({ cmd: 'status' })).status)
  }

  /** Ask macOS for full access when it has not been asked; the answer, or the access as it is. */
  async request(): Promise<EventKitAccess> {
    return accessOf((await this.call({ cmd: 'request' }, this.options.permissionTimeoutMs ?? PERMISSION_TIMEOUT_MS)).status)
  }

  async calendars(): Promise<HelperCalendar[]> {
    const answer = await this.call({ cmd: 'calendars' })
    const list = Array.isArray(answer.calendars) ? answer.calendars : []
    const out: HelperCalendar[] = []
    for (const raw of list as Record<string, unknown>[]) {
      if (!raw || typeof raw.id !== 'string' || !raw.id) continue
      out.push({
        id: raw.id,
        title: typeof raw.title === 'string' ? raw.title : '',
        color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toLowerCase() : undefined,
        source: typeof raw.source === 'string' ? raw.source : undefined,
        sourceType: typeof raw.sourceType === 'string' ? raw.sourceType : undefined,
        type: typeof raw.type === 'string' ? raw.type : undefined,
      })
    }
    return out
  }

  async events(calendarIds: string[], from: number, to: number): Promise<HelperEvents> {
    const answer = await this.call({ cmd: 'events', calendarIds, from, to })
    const events: HelperEvent[] = []
    for (const raw of (Array.isArray(answer.events) ? answer.events : []) as Record<string, unknown>[]) {
      if (!raw || typeof raw.key !== 'string' || typeof raw.start !== 'number' || typeof raw.end !== 'number') continue
      events.push({
        key: raw.key,
        calendarId: typeof raw.calendarId === 'string' ? raw.calendarId : '',
        title: typeof raw.title === 'string' ? raw.title : '',
        location: typeof raw.location === 'string' && raw.location ? raw.location : undefined,
        start: raw.start,
        end: raw.end,
        allDay: raw.allDay === true,
        availability: typeof raw.availability === 'string' ? raw.availability : 'busy',
        status: typeof raw.status === 'string' ? raw.status : 'none',
        self: typeof raw.self === 'string' ? raw.self : undefined,
      })
    }
    return {
      events,
      missing: Array.isArray(answer.missing) ? answer.missing.filter((id): id is string => typeof id === 'string') : [],
      truncated: answer.truncated === true,
    }
  }

  /** Hear about every change of the Mac's calendars until `unwatch`; the helper stays running. */
  watch(onChanged: () => void): void {
    const first = this.onChanged === null
    this.onChanged = onChanged
    // Later calls only replace the listener; a helper that stopped is started again by its pauses.
    if (first) void this.startWatching(false)
  }

  unwatch(): void {
    this.onChanged = null
    if (this.restartTimer !== null) {
      this.clearTimer(this.restartTimer)
      this.restartTimer = null
    }
    this.armIdle()
  }

  get watching(): boolean {
    return this.onChanged !== null
  }

  /** Let the helper go (the app quits, or no Mac calendar is left). */
  close(): void {
    this.onChanged = null
    if (this.restartTimer !== null) this.clearTimer(this.restartTimer)
    this.restartTimer = null
    this.stop()
  }

  // --- The process --------------------------------------------------------------------------------

  private async startWatching(afterRestart: boolean): Promise<void> {
    if (!this.onChanged) return
    try {
      await this.call({ cmd: 'watch' })
      if (this.running) this.running.watchSent = true
      // A helper that was started again may have missed a change.
      if (afterRestart) this.onChanged?.()
    } catch {
      this.scheduleRestart()
    }
  }

  private scheduleRestart(): void {
    if (!this.onChanged || this.restartTimer !== null) return
    const delays = this.options.restartDelaysMs ?? RESTART_DELAYS_MS
    const delay = delays[Math.min(this.restarts, delays.length - 1)]
    this.restarts++
    this.restartTimer = this.setTimer(() => {
      this.restartTimer = null
      void this.startWatching(true)
    }, delay)
  }

  private ensureRunning(): Running {
    if (this.running && !this.running.closing) return this.running
    let child: HelperChild
    try {
      child = this.options.spawn()
    } catch (error) {
      throw error instanceof CalendarReadError ? error : new CalendarReadError(STOPPED_MESSAGE, 'other')
    }
    const running: Running = { child, pending: new Map(), closing: false, watchSent: false }
    this.running = running
    const lines = createLineSplitter()
    const settle = (error: Error) => {
      for (const [, pending] of running.pending) {
        this.clearTimer(pending.timer)
        pending.reject(error)
      }
      running.pending.clear()
    }
    const ended = () => {
      if (this.running === running) this.running = null
      settle(new CalendarReadError(STOPPED_MESSAGE, 'other'))
      // A helper that stopped on its own while watched is started again after a pause.
      if (!running.closing && this.onChanged) this.scheduleRestart()
    }
    child.stdout?.on('data', (chunk) => {
      for (const line of lines.push(chunk)) this.handleLine(running, line)
    })
    child.stderr?.on('data', () => {})
    child.stdin?.on?.('error', () => {})
    child.on('error', ended)
    child.on('exit', () => {
      for (const line of lines.flush()) this.handleLine(running, line)
      ended()
    })
    return running
  }

  private handleLine(running: Running, line: string): void {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) return
    let message: Record<string, unknown>
    try {
      message = JSON.parse(trimmed)
    } catch {
      return
    }
    if (!message || typeof message !== 'object') return
    if (message.type === 'changed') {
      // Watching again worked: the pauses start over.
      this.restarts = 0
      this.onChanged?.()
      return
    }
    if (typeof message.id !== 'number') return
    const pending = running.pending.get(message.id)
    if (!pending) return
    running.pending.delete(message.id)
    this.clearTimer(pending.timer)
    if (message.ok === true) pending.resolve(message)
    else if (message.code === 'denied') pending.reject(new CalendarReadError(EVENTKIT_DENIED_MESSAGE, 'forbidden'))
    else pending.reject(new CalendarReadError('The calendars of this Mac could not be read.', 'other'))
    this.armIdle()
  }

  private call(request: Record<string, unknown>, timeoutMs = this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS): Promise<Record<string, unknown>> {
    if (this.idleTimer !== null) {
      this.clearTimer(this.idleTimer)
      this.idleTimer = null
    }
    let running: Running
    try {
      running = this.ensureRunning()
    } catch (error) {
      return Promise.reject(error)
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = this.setTimer(() => {
        if (!running.pending.delete(id)) return
        reject(new CalendarReadError('The calendars of this Mac did not answer in time.', 'timeout'))
        this.armIdle()
      }, timeoutMs)
      running.pending.set(id, { resolve, reject, timer })
      try {
        running.child.stdin?.write(`${JSON.stringify({ id, ...request })}\n`)
      } catch {
        // The helper is gone; its exit rejects the request.
      }
    })
  }

  /** Without a watch and with nothing waiting, let the helper go after a while. */
  private armIdle(): void {
    if (this.onChanged || !this.running || this.running.pending.size > 0) return
    if (this.idleTimer !== null) this.clearTimer(this.idleTimer)
    this.idleTimer = this.setTimer(() => {
      this.idleTimer = null
      if (!this.onChanged && this.running && this.running.pending.size === 0) this.stop()
    }, this.options.idleMs ?? IDLE_MS)
  }

  private stop(): void {
    if (this.idleTimer !== null) this.clearTimer(this.idleTimer)
    this.idleTimer = null
    const running = this.running
    if (!running) return
    running.closing = true
    this.running = null
    try {
      running.child.stdin?.end()
    } catch {
      // Already closed.
    }
    // Closing stdin ends the helper; one that does not go is killed.
    this.setTimer(() => {
      try {
        running.child.kill()
      } catch {
        // Gone.
      }
    }, 2000)
  }
}
