/**
 * Task reminder scheduling (D-NOTIF-1, D-NOTIF-2, D-NOTIF-4), kept free of Electron so the timing
 * rules run in unit tests with fake timers. `notifications.ts` wires it to the real API client,
 * config and notification windows.
 *
 * How it works:
 * - A refresh asks the server for open tasks with a reminder in a window around now (not for every
 *   open task) and arms one timer per reminder. It runs at start-up, every 15 minutes, on window
 *   focus (throttled), after the computer resumes (`rescheduleNotifications`), and after a task is
 *   completed, uncompleted, deleted or its reminders change (the renderer asks for it).
 * - A timer is only armed when its delay fits `setTimeout` (about 24.8 days). Reminders further
 *   out are left for a later refresh to pick up.
 * - When a timer fires the task is checked again, because the world moves between arming and
 *   firing: it may be done, deleted, or its reminder moved on another device.
 * - Everything respects the master notification toggle, at refresh time and at fire time.
 */

import { KEEP_NESTED_SUBTASKS_PARAM, MAX_PAGE_SIZE } from './api-v2'

export const REFRESH_INTERVAL_MS = 15 * 60_000
/** Window focus refreshes at most this often. */
export const FOCUS_REFRESH_MIN_MS = 2 * 60_000
/**
 * How long `refreshSoon` waits for more requests before it refreshes. Completing, deleting or
 * editing a task each ask for a refresh; a bulk change asks many times in a row and needs one.
 */
export const REFRESH_DEBOUNCE_MS = 1_000
/** Reminders further out than this are left to a later refresh. */
export const REMINDER_WINDOW_MS = 25 * 24 * 60 * 60_000
/**
 * A reminder that came due this long ago, found by a refresh that is not the session's first, still
 * shows: it was set on another device a moment before it was due, and "late" beats "never".
 */
export const CATCH_UP_MS = 20 * 60_000
/** `setTimeout` keeps its delay in a signed 32-bit integer; longer delays fire immediately. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647
/** How long a fired reminder is remembered, so a refresh never shows it twice. */
const FIRED_RETENTION_MS = 2 * 24 * 60 * 60_000

export interface ReminderTask {
  id: number
  title: string
  done?: boolean
  reminders?: Array<{ reminder: string }> | null
}

export interface ReminderConfig {
  notifications_enabled?: boolean
  standalone_mode?: boolean
}

type FetchResult<T> = { success: true; data: T } | { success: false; error: string; statusCode?: number }

export interface TaskReminderDeps {
  loadConfig(): ReminderConfig | null
  fetchTasks(params: Record<string, unknown>): Promise<FetchResult<unknown[]>>
  fetchTaskById(id: number): Promise<FetchResult<unknown>>
  /** The user completed or deleted the task here and the server has not been told yet. */
  isClosedLocally(taskId: number): boolean
  /** Show the notification. */
  show(taskId: number, title: string, config: ReminderConfig): void
  now(): number
}

export interface TaskReminderScheduler {
  /** Fetch the reminders in the window and re-arm every timer. Safe to call at any time. */
  refresh(): Promise<void>
  /**
   * Ask for a refresh once requests stop coming for `REFRESH_DEBOUNCE_MS` (trailing): what every
   * completed, deleted or edited task calls, so a bulk change makes one request instead of one per task.
   */
  refreshSoon(): void
  /** `refresh`, unless one started very recently. */
  refreshOnFocus(): void
  /** First refresh now, then every 15 minutes. */
  start(): void
  /** Stop the interval and cancel every timer. */
  stop(): void
  /** Armed timers; for tests. */
  scheduledCount(): number
}

function remindersOf(task: ReminderTask): number[] {
  if (!Array.isArray(task.reminders)) return []
  const times: number[] = []
  for (const r of task.reminders) {
    if (!r || typeof r.reminder !== 'string' || !r.reminder) continue
    const at = Date.parse(r.reminder)
    if (!Number.isNaN(at)) times.push(at)
  }
  return times
}

function remindersEnabled(config: ReminderConfig | null): config is ReminderConfig {
  return !!config && !config.standalone_mode && config.notifications_enabled === true
}

export function createTaskReminderScheduler(deps: TaskReminderDeps): TaskReminderScheduler {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** key -> reminder time, for reminders already shown (or deliberately not shown) this session. */
  const handled = new Map<string, number>()
  let generation = 0
  let refreshedOnce = false
  let lastRefreshAt = Number.NEGATIVE_INFINITY
  let interval: ReturnType<typeof setInterval> | null = null
  let soonTimer: ReturnType<typeof setTimeout> | null = null

  function cancelSoon(): void {
    if (soonTimer !== null) clearTimeout(soonTimer)
    soonTimer = null
  }

  function clearTimers(): void {
    for (const id of timers.values()) clearTimeout(id)
    timers.clear()
  }

  async function onTimer(key: string, taskId: number, title: string, at: number): Promise<void> {
    timers.delete(key)
    if (handled.has(key)) return
    if (!remindersEnabled(deps.loadConfig())) return
    if (deps.isClosedLocally(taskId)) return

    let currentTitle = title
    const check = await deps.fetchTaskById(taskId)
    if (check.success) {
      const current = check.data as ReminderTask | null
      if (!current || current.done === true) return
      // Moved or removed since it was armed: the refresh that saw the change arms the new time.
      if (!remindersOf(current).includes(at)) return
      if (typeof current.title === 'string' && current.title) currentTitle = current.title
    } else if (check.statusCode === 404 || check.statusCode === 403) {
      return // the task is gone, or no longer visible to this account
    }
    // Any other failure (offline, a server error) cannot tell us the reminder is stale, and a missed
    // reminder is worse than a spurious one, so the scheduled data is used.

    // Settings may have changed while the check was in flight.
    const config = deps.loadConfig()
    if (!remindersEnabled(config) || deps.isClosedLocally(taskId) || handled.has(key)) return
    handled.set(key, at)
    deps.show(taskId, currentTitle, config)
  }

  async function refresh(): Promise<void> {
    const mine = ++generation
    lastRefreshAt = deps.now()

    const config = deps.loadConfig()
    if (!remindersEnabled(config)) {
      clearTimers()
      return
    }

    const from = deps.now() - CATCH_UP_MS
    const to = deps.now() + REMINDER_WINDOW_MS
    const result = await deps.fetchTasks({
      filter: `done = false && reminders > '${new Date(from).toISOString()}' && reminders < '${new Date(to).toISOString()}'`,
      // A subtask's own reminder must not be hidden because its parent is in the result too, and a
      // full page keeps the common case at one request.
      [KEEP_NESTED_SUBTASKS_PARAM]: true,
      per_page: MAX_PAGE_SIZE,
    })
    // A newer refresh (or stop) started while this one was waiting: it owns the timers now.
    if (mine !== generation) return
    // Offline or a server error: the timers armed earlier are still right, keep them.
    if (!result.success || !Array.isArray(result.data)) return

    const firstOfSession = !refreshedOnce
    refreshedOnce = true
    clearTimers()

    const now = deps.now()
    for (const [key, at] of handled) if (at < now - FIRED_RETENTION_MS) handled.delete(key)

    for (const raw of result.data) {
      const task = raw as ReminderTask
      if (!task || typeof task.id !== 'number' || task.done === true) continue
      for (const at of remindersOf(task)) {
        const key = `${task.id}-${at}`
        if (at > now) {
          const delay = at - now
          if (delay > MAX_TIMER_DELAY_MS || timers.has(key)) continue
          timers.set(key, setTimeout(() => { void onTimer(key, task.id, task.title, at) }, delay))
        } else if (now - at <= CATCH_UP_MS && !handled.has(key)) {
          handled.set(key, at)
          // What came due before the app started is not announced late; it is only remembered so
          // a later refresh does not mistake it for a newly found reminder.
          if (!firstOfSession && !deps.isClosedLocally(task.id)) deps.show(task.id, task.title, config)
        }
      }
    }
  }

  return {
    refresh,
    refreshSoon() {
      cancelSoon()
      soonTimer = setTimeout(() => {
        soonTimer = null
        void refresh()
      }, REFRESH_DEBOUNCE_MS)
    },
    refreshOnFocus() {
      if (deps.now() - lastRefreshAt < FOCUS_REFRESH_MIN_MS) return
      void refresh()
    },
    start() {
      if (interval !== null) clearInterval(interval)
      void refresh()
      interval = setInterval(() => { void refresh() }, REFRESH_INTERVAL_MS)
    },
    stop() {
      generation++
      cancelSoon()
      if (interval !== null) clearInterval(interval)
      interval = null
      clearTimers()
    },
    scheduledCount: () => timers.size,
  }
}
