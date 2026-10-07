import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CATCH_UP_MS,
  FOCUS_REFRESH_MIN_MS,
  MAX_TIMER_DELAY_MS,
  REFRESH_DEBOUNCE_MS,
  REFRESH_INTERVAL_MS,
  REMINDER_WINDOW_MS,
  createTaskReminderScheduler,
  type ReminderTask,
  type TaskReminderDeps,
} from '../task-reminders'

const MIN = 60_000
const DAY = 24 * 60 * MIN
const T0 = Date.parse('2026-10-07T09:00:00.000Z')

const iso = (ms: number) => new Date(ms).toISOString()

function task(id: number, reminderAt: number | number[], extra: Partial<ReminderTask> = {}): ReminderTask {
  const times = Array.isArray(reminderAt) ? reminderAt : [reminderAt]
  return { id, title: `Task ${id}`, done: false, reminders: times.map((t) => ({ reminder: iso(t) })), ...extra }
}

describe('task reminder scheduling (D-NOTIF-1, D-NOTIF-2, D-NOTIF-4)', () => {
  let tasks: ReminderTask[]
  let notificationsEnabled: boolean
  let standalone: boolean
  let fetchTasks: ReturnType<typeof vi.fn>
  let fetchTaskById: ReturnType<typeof vi.fn>
  let show: ReturnType<typeof vi.fn>
  let closedLocally: Set<number>
  let scheduler: ReturnType<typeof createTaskReminderScheduler>

  const make = (overrides: Partial<TaskReminderDeps> = {}) =>
    createTaskReminderScheduler({
      loadConfig: () => ({ notifications_enabled: notificationsEnabled, standalone_mode: standalone }),
      fetchTasks: fetchTasks as never,
      fetchTaskById: fetchTaskById as never,
      isClosedLocally: (id) => closedLocally.has(id),
      show: show as never,
      now: () => Date.now(),
      ...overrides,
    })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    tasks = []
    notificationsEnabled = true
    standalone = false
    closedLocally = new Set()
    fetchTasks = vi.fn(async () => ({ success: true, data: tasks }))
    fetchTaskById = vi.fn(async (id: number) => {
      const found = tasks.find((t) => t.id === id)
      return found ? { success: true, data: found } : { success: false, error: 'Not found', statusCode: 404 }
    })
    show = vi.fn()
    scheduler = make()
  })

  afterEach(() => {
    scheduler.stop()
    vi.useRealTimers()
  })

  describe('what is fetched', () => {
    it('asks the server only for open tasks with a reminder in the next 25 days (not every open task)', async () => {
      await scheduler.refresh()

      expect(fetchTasks).toHaveBeenCalledTimes(1)
      const params = fetchTasks.mock.calls[0][0] as { filter: string }
      expect(params.filter).toBe(
        `done = false && reminders > '${iso(T0 - CATCH_UP_MS)}' && reminders < '${iso(T0 + REMINDER_WINDOW_MS)}'`
      )
      expect(REMINDER_WINDOW_MS).toBe(25 * DAY)
    })

    it('keeps nested subtasks in the result and asks for full pages (D-NOTIF-4)', async () => {
      await scheduler.refresh()

      // Without this the main process drops a subtask whose parent is in the same result, and the
      // subtask's own reminder would never fire.
      expect(fetchTasks.mock.calls[0][0]).toMatchObject({ keep_nested_subtasks: true, per_page: 1000 })
    })

    it('does nothing in standalone mode', async () => {
      standalone = true
      await scheduler.refresh()
      expect(fetchTasks).not.toHaveBeenCalled()
    })
  })

  describe('the master notification toggle (D-NOTIF-1)', () => {
    it('does not fetch or schedule anything while task reminders are off', async () => {
      notificationsEnabled = false
      tasks = [task(1, T0 + 10 * MIN)]

      await scheduler.refresh()
      await vi.advanceTimersByTimeAsync(11 * MIN)

      expect(fetchTasks).not.toHaveBeenCalled()
      expect(show).not.toHaveBeenCalled()
    })

    it('clears timers that were already set when the toggle is turned off, and does not fire them', async () => {
      tasks = [task(1, T0 + 10 * MIN)]
      await scheduler.refresh()
      expect(scheduler.scheduledCount()).toBe(1)

      notificationsEnabled = false
      await scheduler.refresh()
      expect(scheduler.scheduledCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(11 * MIN)

      expect(show).not.toHaveBeenCalled()
    })

    it('does not show a reminder whose timer was set while the toggle was on and which fires after it was turned off', async () => {
      tasks = [task(1, T0 + 10 * MIN)]
      await scheduler.refresh()

      notificationsEnabled = false // no refresh in between (the setting changed on another path)
      await vi.advanceTimersByTimeAsync(11 * MIN)

      expect(show).not.toHaveBeenCalled()
    })
  })

  describe('scheduling', () => {
    it('shows a reminder at its time, with the task title', async () => {
      tasks = [task(7, T0 + 10 * MIN, { title: 'Pay rent' })]
      await scheduler.refresh()

      await vi.advanceTimersByTimeAsync(9 * MIN)
      expect(show).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2 * MIN)

      expect(show).toHaveBeenCalledTimes(1)
      expect(show).toHaveBeenCalledWith(7, 'Pay rent', expect.anything())
    })

    it('schedules each reminder of a task, and ignores a task without any', async () => {
      tasks = [task(1, [T0 + 5 * MIN, T0 + 20 * MIN]), { id: 2, title: 'No reminder', done: false, reminders: null }]
      await scheduler.refresh()
      expect(scheduler.scheduledCount()).toBe(2)

      await vi.advanceTimersByTimeAsync(6 * MIN)
      expect(show).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(15 * MIN)
      expect(show).toHaveBeenCalledTimes(2)
    })

    it('keeps the timers it has when a refresh fails (offline), instead of dropping every reminder', async () => {
      tasks = [task(1, T0 + 10 * MIN)]
      await scheduler.refresh()
      fetchTasks.mockResolvedValueOnce({ success: false, error: 'net::ERR_INTERNET_DISCONNECTED' })

      await scheduler.refresh()
      expect(scheduler.scheduledCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(11 * MIN)

      expect(show).toHaveBeenCalledTimes(1)
    })

    it('replaces the timers with what the server says now (a reminder moved on another device)', async () => {
      tasks = [task(1, T0 + 10 * MIN)]
      await scheduler.refresh()
      tasks = [task(1, T0 + 30 * MIN)]
      await scheduler.refresh()

      expect(scheduler.scheduledCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(11 * MIN)
      expect(show).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(20 * MIN)
      expect(show).toHaveBeenCalledTimes(1)
    })

    it('never fires twice when two refreshes overlap', async () => {
      tasks = [task(1, T0 + 10 * MIN)]
      let release: (() => void) | null = null
      fetchTasks.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ success: true, data: tasks }) }))

      const slow = scheduler.refresh()
      const fast = scheduler.refresh() // supersedes the slow one
      await fast
      release!()
      await slow
      await vi.advanceTimersByTimeAsync(11 * MIN)

      expect(show).toHaveBeenCalledTimes(1)
    })
  })

  describe('long timers (setTimeout overflows after about 24.8 days)', () => {
    it('does not schedule a reminder beyond the timer maximum, and picks it up from the periodic refresh', async () => {
      const at = T0 + MAX_TIMER_DELAY_MS + 2 * MIN
      tasks = [task(1, at)]
      scheduler.start()
      await vi.advanceTimersByTimeAsync(0)

      expect(scheduler.scheduledCount()).toBe(0)

      // Two minutes into the future of the maximum, a refresh arrives that is within range.
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS)
      expect(scheduler.scheduledCount()).toBe(1)

      await vi.advanceTimersByTimeAsync(MAX_TIMER_DELAY_MS - REFRESH_INTERVAL_MS + 3 * MIN)
      expect(show).toHaveBeenCalledTimes(1)
    })
  })

  describe('re-checking the task when its reminder fires (D-NOTIF-2)', () => {
    const fireOne = async () => {
      tasks = [task(1, T0 + 10 * MIN, { title: 'Call the bank' })]
      await scheduler.refresh()
    }

    it('skips the reminder of a task that was completed since it was scheduled', async () => {
      await fireOne()
      tasks = [{ ...tasks[0], done: true }]

      await vi.advanceTimersByTimeAsync(11 * MIN)

      expect(fetchTaskById).toHaveBeenCalledWith(1)
      expect(show).not.toHaveBeenCalled()
    })

    it('skips the reminder of a task that was deleted', async () => {
      await fireOne()
      tasks = []

      await vi.advanceTimersByTimeAsync(11 * MIN)

      expect(show).not.toHaveBeenCalled()
    })

    it('skips it when the reminder was moved or removed on another device', async () => {
      await fireOne()
      tasks = [task(1, T0 + 3 * 60 * MIN)]

      await vi.advanceTimersByTimeAsync(11 * MIN)

      expect(show).not.toHaveBeenCalled()
    })

    it('shows the current title when it was renamed', async () => {
      await fireOne()
      tasks = [{ ...tasks[0], title: 'Call the bank (urgent)' }]

      await vi.advanceTimersByTimeAsync(11 * MIN)

      expect(show).toHaveBeenCalledWith(1, 'Call the bank (urgent)', expect.anything())
    })

    it('skips a task the user completed or deleted offline, which the server does not know yet', async () => {
      await fireOne()
      closedLocally.add(1)

      await vi.advanceTimersByTimeAsync(11 * MIN)

      expect(show).not.toHaveBeenCalled()
    })

    it('still shows the reminder when the task cannot be checked because the app is offline', async () => {
      await fireOne()
      fetchTaskById.mockResolvedValue({ success: false, error: 'net::ERR_INTERNET_DISCONNECTED' })

      await vi.advanceTimersByTimeAsync(11 * MIN)

      expect(show).toHaveBeenCalledTimes(1)
    })
  })

  describe('when it refreshes', () => {
    it('refreshes every 15 minutes after start, and stops on stop()', async () => {
      scheduler.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchTasks).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS)
      expect(fetchTasks).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS)
      expect(fetchTasks).toHaveBeenCalledTimes(3)

      scheduler.stop()
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 2)
      expect(fetchTasks).toHaveBeenCalledTimes(3)
      expect(REFRESH_INTERVAL_MS).toBe(15 * MIN)
    })

    it('refreshes on focus, but not more often than the throttle', async () => {
      await scheduler.refresh()
      expect(fetchTasks).toHaveBeenCalledTimes(1)

      scheduler.refreshOnFocus() // right after a refresh: throttled
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchTasks).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(FOCUS_REFRESH_MIN_MS + 1000)
      scheduler.refreshOnFocus()
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchTasks).toHaveBeenCalledTimes(2)
    })
  })

  // F8: every completed, deleted or edited task asks for a refresh. Completing 20 tasks at once
  // used to send 20 requests for the same list; the requests now collapse into one.
  describe('refreshSoon: a burst of requests becomes one refresh', () => {
    it('waits a moment, then refreshes once however many requests came', async () => {
      for (let i = 0; i < 20; i++) scheduler.refreshSoon()

      await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS - 1)
      expect(fetchTasks).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(fetchTasks).toHaveBeenCalledTimes(1)

      // Nothing is left over from the burst.
      await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS * 5)
      expect(fetchTasks).toHaveBeenCalledTimes(1)
      expect(REFRESH_DEBOUNCE_MS).toBe(1000)
    })

    it('restarts the wait with every request, so the refresh runs after the last one (trailing)', async () => {
      scheduler.refreshSoon()
      await vi.advanceTimersByTimeAsync(600)
      scheduler.refreshSoon()
      await vi.advanceTimersByTimeAsync(600)
      scheduler.refreshSoon()

      await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS - 1)
      expect(fetchTasks).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchTasks).toHaveBeenCalledTimes(1)
    })

    it('a request after the refresh started a new wait and a second refresh', async () => {
      scheduler.refreshSoon()
      await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
      expect(fetchTasks).toHaveBeenCalledTimes(1)

      scheduler.refreshSoon()
      scheduler.refreshSoon()
      await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
      expect(fetchTasks).toHaveBeenCalledTimes(2)
    })

    it('does not delay refresh(), which runs at once', async () => {
      scheduler.refreshSoon()
      await scheduler.refresh()
      expect(fetchTasks).toHaveBeenCalledTimes(1)
    })

    it('stop() cancels a refresh that was waiting', async () => {
      scheduler.refreshSoon()
      scheduler.stop()
      await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS * 3)
      expect(fetchTasks).not.toHaveBeenCalled()
    })

    it('arms the timers from the refresh it runs, like any other refresh', async () => {
      tasks = [task(1, T0 + 10 * MIN)]
      scheduler.refreshSoon()
      scheduler.refreshSoon()
      await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
      expect(scheduler.scheduledCount()).toBe(1)
    })
  })

  describe('reminders that came due while nothing was scheduled', () => {
    it('shows a reminder that became due a few minutes ago once, after the first refresh of the session', async () => {
      await scheduler.refresh() // the first refresh of a session never catches up
      tasks = [task(1, T0 - 5 * MIN)]

      await scheduler.refresh()
      expect(show).toHaveBeenCalledTimes(1)

      await scheduler.refresh()
      expect(show).toHaveBeenCalledTimes(1)
    })

    it('does not show what was due before the app started, even within the catch-up window', async () => {
      tasks = [task(1, T0 - 5 * MIN)]
      await scheduler.refresh()
      expect(show).not.toHaveBeenCalled()
    })

    it('does not announce it on a later refresh either (it is remembered, not forgotten)', async () => {
      tasks = [task(1, T0 - 5 * MIN)]
      await scheduler.refresh()
      await vi.advanceTimersByTimeAsync(10 * MIN)
      await scheduler.refresh()
      expect(show).not.toHaveBeenCalled()
    })

    it('ignores a reminder from before the catch-up window', async () => {
      await scheduler.refresh()
      tasks = [task(1, T0 - CATCH_UP_MS - MIN)]
      await scheduler.refresh()
      expect(show).not.toHaveBeenCalled()
    })

    it('does not show a catch-up for a completed task', async () => {
      await scheduler.refresh()
      tasks = [task(1, T0 - 5 * MIN, { done: true })]
      await scheduler.refresh()
      expect(show).not.toHaveBeenCalled()
    })
  })
})
