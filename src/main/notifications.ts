import { app, Notification, nativeImage, BrowserWindow } from 'electron'
import { join } from 'path'
import { loadConfig, type AppConfig } from './config'
import { MAX_PAGE_SIZE } from './api-v2'
import { fetchProjects, fetchTaskById, fetchTasks } from './api-client'
import { isHiddenTask } from '../shared/hidden-tasks'
import { loadRoutineCarriers } from './carrier-service'
import { ensureKnownUserId } from './known-user'
import { getSyncedPrefs } from './synced-preferences'
import { occurrenceStillOpen, routineRemindsHere, type RoutineReminderContext } from './routine-reminder-rules'
import { createdById } from '../shared/hidden-tasks'
import { effectivePermission } from '../shared/collaboration'
import { getAllStandaloneTasks } from './cache'
import { getOfflineQueue } from './offline/service'
import { createTaskReminderScheduler } from './task-reminders'
import { notificationCategory, notificationFilters, overdueDays } from './notification-windows'
import { addLocalDays, startOfLocalDay, toLocalDate } from '../shared/due-dates'
import { isSharedRoutine, parseRoutineEnvelope, preferOwnRoutineCarriers, routineOccurrenceKey, scheduledDateOn, type RoutinePayload } from '../shared/routines'
import { isPlannerEnabled, isRoutinesEnabled } from '../shared/config-types'

const NULL_DATE = '0001-01-01T00:00:00Z'

// Active timer IDs so we can cancel on reschedule
let dailyTimerId: ReturnType<typeof setTimeout> | null = null
let plannerNudgeTimerId: ReturnType<typeof setTimeout> | null = null
let secondaryTimerId: ReturnType<typeof setTimeout> | null = null
let routineRefreshTimerId: ReturnType<typeof setTimeout> | null = null

const routineReminderTimers = new Map<string, ReturnType<typeof setTimeout>>()

// Reference to main window (set during init)
let mainWindowRef: BrowserWindow | null = null

/** The user completed or deleted the task here and the offline queue has not told the server yet. */
function isClosedLocally(taskId: number): boolean {
  try {
    return getOfflineQueue().getPending().some((action) =>
      (action.type === 'delete' && action.taskId === taskId) ||
      (action.type === 'update' && action.taskId === taskId && action.patch.done === true)
    )
  } catch {
    return false
  }
}

// Task reminders: one refresh from the server every 15 minutes (and on focus, resume and after a
// task changes), one timer per reminder, a re-check when each fires. See ./task-reminders.ts.
const taskReminders = createTaskReminderScheduler({
  loadConfig,
  fetchTasks,
  fetchTaskById,
  isClosedLocally,
  show: (taskId, title, config) => fireTaskReminder(taskId, title, config as AppConfig),
  now: () => Date.now(),
})

/**
 * Attach failure logging for desktop notifications. On macOS, Electron 42+
 * uses UNNotification which requires a code-signed app — unsigned/dev builds
 * emit `failed` instead of showing the notification.
 */
function attachNotificationDiagnostics(notification: Notification, context: string): void {
  notification.on('failed', (_event, error) => {
    console.warn(`[Notifications] ${context} failed:`, error)
  })
}

// --- Public API ---

export function initNotifications(mainWindow: BrowserWindow | null): void {
  mainWindowRef = mainWindow
  scheduleAll()
  taskReminders.start()
  refreshRoutineReminders()
  scheduleRoutineRefresh()
  schedulePlannerNudge()
}

/** Update the main-window ref after a recreation without rescheduling timers. */
export function setNotificationsMainWindow(mainWindow: BrowserWindow | null): void {
  mainWindowRef = mainWindow
}

export function rescheduleNotifications(): void {
  clearTimers()
  scheduleAll()
  void refreshTaskReminders()
  refreshRoutineReminders()
  scheduleRoutineRefresh()
  schedulePlannerNudge()
}

export function stopNotifications(): void {
  clearTimers()
  taskReminders.stop()
  clearRoutineReminderTimers()
}

/** Schedule the next three weeks of routine alarms stored in hidden carrier tasks. */
export async function refreshRoutineReminders(): Promise<void> {
  clearRoutineReminderTimers()
  const config = loadConfig()
  if (!config?.notifications_enabled || config.standalone_mode || !isRoutinesEnabled(config)) return

  // Carriers are fetched by their remembered ids; the done tasks are not listed (D-NOTIF-3). They
  // include the routines other people shared with this account (section 6.9).
  const result = await loadRoutineCarriers()
  if (!result.success) return
  const now = Date.now()
  const today = toLocalDate(new Date())
  const tasks = result.data as unknown as Array<Record<string, unknown>>
  const context = await reminderContext(tasks)

  // Archive parts and malformed carriers have no payload and are skipped. Where another member's
  // carrier has the id of one of the user's own routines, only the user's own reminds (review S-5).
  const carriers = preferOwnRoutineCarriers(
    tasks.flatMap((task) => {
      const payload = parseRoutineEnvelope(typeof task.description === 'string' ? task.description : '').payload
      return payload ? [{ task: task as Record<string, unknown> & { id: number; created_by?: { id?: unknown } | null }, payload }] : []
    }),
    context.me,
  )
  for (const { task, payload } of carriers) {
    if (payload.definition.archived) continue
    if (!routineRemindsHere(task, payload, context)) continue
    const taskId = typeof task.id === 'number' ? task.id : 0
    for (let offset = 0; offset <= 21; offset += 1) {
      const candidate = addLocalDays(today, offset)
      // The same scheduling rules as the Today view (src/shared/routines.ts); reminders only
      // fire on the due date itself, never for an overdue chore carried over to today.
      const scheduledDate = scheduledDateOn(payload, candidate)
      if (!scheduledDate) continue
      for (const slot of payload.definition.slots) {
        if (!slot.reminderEnabled) continue
        const key = routineOccurrenceKey(payload.definition.id, scheduledDate, slot.id)
        const status = payload.occurrences[key]?.status ?? 'PENDING'
        if (status !== 'PENDING') continue
        const base = localDateAtMinutes(candidate, slot.reminderMinutes).getTime()
        scheduleRoutineTimer(`${key}:primary`, base, now, payload, false, config, { taskId, occurrenceKey: key })
        if (slot.followUpMinutes > 0) {
          scheduleRoutineTimer(`${key}:followup`, base + slot.followUpMinutes * 60_000, now, payload, true, config, { taskId, occurrenceKey: key })
        }
      }
    }
  }
}

/**
 * Who you are, the synced preferences, and (only when someone else's shared routine is among the
 * carriers) your permission per project, for `routineRemindsHere`. A project list that cannot be read
 * leaves the permission unknown, which counts as write.
 */
async function reminderContext(tasks: Array<Record<string, unknown>>): Promise<RoutineReminderContext> {
  const me = (await ensureKnownUserId()) ?? null
  const prefs = getSyncedPrefs().values
  const othersShared = tasks.some((task) => createdById(task) !== me)
  const permissions = new Map<number, number>()
  if (othersShared) {
    const projects = await fetchProjects(true)
    if (projects.success) {
      for (const project of projects.data as Array<{ id?: unknown; max_permission?: number; is_archived?: boolean }>) {
        if (typeof project.id === 'number') permissions.set(project.id, effectivePermission(project.max_permission, project.is_archived))
      }
    }
  }
  return { me, prefs, permissionOf: (projectId) => permissions.get(projectId) ?? null }
}

/**
 * Re-read the upcoming reminders from the server and re-arm the timers. Call it after anything that
 * can change them: a completed, reopened or deleted task, edited reminders or due date.
 */
export function refreshTaskReminders(): Promise<void> {
  return taskReminders.refresh()
}

/**
 * What a completed, deleted or edited task calls: the refresh runs once the changes stop coming
 * (about a second later), so completing 20 tasks at once reads the reminder list once, not 20 times.
 */
export function refreshTaskRemindersSoon(): void {
  taskReminders.refreshSoon()
}

/** Window focus: refresh unless a refresh ran a moment ago. */
export function refreshTaskRemindersOnFocus(): void {
  taskReminders.refreshOnFocus()
}

export function sendTestNotification(): void {
  const config = loadConfig()
  const notification = new Notification({
    title: 'Vicu — Test Notification',
    body: 'Notifications are working! You will receive task reminders at your scheduled times.',
    silent: !(config?.notifications_sound ?? true),
    timeoutType: config?.notifications_persistent ? 'never' : 'default',
    icon: getIcon(),
  })
  attachNotificationDiagnostics(notification, 'test notification')
  notification.show()
}

// --- Scheduling ---

/** Plan my day's evening nudge (contract 14.10): per device, one notification at the time set. */
function schedulePlannerNudge(): void {
  if (plannerNudgeTimerId !== null) {
    clearTimeout(plannerNudgeTimerId)
    plannerNudgeTimerId = null
  }
  const config = loadConfig()
  const time = config?.planner_nudge
  if (!config?.notifications_enabled || !isPlannerEnabled(config) || typeof time !== 'string') return
  const [hours, minutes] = time.split(':').map(Number)
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  plannerNudgeTimerId = setTimeout(() => {
    plannerNudgeTimerId = null
    const current = loadConfig()
    if (current?.notifications_enabled && isPlannerEnabled(current) && current.planner_nudge === time) {
      const notification = new Notification({
        title: 'Plan tomorrow',
        body: 'Set up tomorrow in Plan my day.',
        silent: !current.notifications_sound,
        icon: getIcon(),
      })
      attachNotificationDiagnostics(notification, 'plan nudge')
      notification.on('click', () => {
        showMainWindow()
        mainWindowRef?.webContents.send('navigate', '/plan')
      })
      notification.show()
    }
    schedulePlannerNudge()
  }, next.getTime() - now.getTime())
}

function clearTimers(): void {
  if (plannerNudgeTimerId !== null) {
    clearTimeout(plannerNudgeTimerId)
    plannerNudgeTimerId = null
  }
  if (dailyTimerId !== null) {
    clearTimeout(dailyTimerId)
    dailyTimerId = null
  }
  if (secondaryTimerId !== null) {
    clearTimeout(secondaryTimerId)
    secondaryTimerId = null
  }
  if (routineRefreshTimerId !== null) {
    clearTimeout(routineRefreshTimerId)
    routineRefreshTimerId = null
  }
}

function scheduleRoutineRefresh(): void {
  if (routineRefreshTimerId !== null) clearTimeout(routineRefreshTimerId)
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 5, 0, 0)
  routineRefreshTimerId = setTimeout(() => {
    void refreshRoutineReminders()
    scheduleRoutineRefresh()
  }, next.getTime() - now.getTime())
}

function clearRoutineReminderTimers(): void {
  for (const timerId of routineReminderTimers.values()) clearTimeout(timerId)
  routineReminderTimers.clear()
}

/** The carrier and occurrence a routine timer is for, so it can look again when it fires. */
interface RoutineTimerTarget {
  taskId: number
  occurrenceKey: string
}

function scheduleRoutineTimer(
  key: string,
  triggerAt: number,
  now: number,
  payload: RoutinePayload,
  followUp: boolean,
  config: AppConfig,
  target: RoutineTimerTarget,
): void {
  const delay = triggerAt - now
  if (delay <= 0 || delay > 2_147_483_647 || routineReminderTimers.has(key)) return
  const timerId = setTimeout(() => {
    routineReminderTimers.delete(key)
    void fireRoutineReminder(payload, followUp, config, target)
  }, delay)
  routineReminderTimers.set(key, timerId)
}

/**
 * The routine as the server has it now when it is shared (section 6.9): another person may have
 * ticked it off, or this account hid it or turned its reminders off, since the timers were planned.
 * Null when it could not be read (offline): the reminder shows as planned.
 */
async function freshSharedRoutine(target: RoutineTimerTarget): Promise<{ task: Record<string, unknown>; payload: RoutinePayload } | null> {
  if (target.taskId <= 0) return null
  const result = await fetchTaskById(target.taskId)
  if (!result.success) return null
  const task = result.data as Record<string, unknown>
  const payload = parseRoutineEnvelope(typeof task.description === 'string' ? task.description : '').payload
  return payload ? { task, payload } : null
}

async function fireRoutineReminder(
  payload: RoutinePayload,
  followUp: boolean,
  configSnapshot: AppConfig,
  target: RoutineTimerTarget,
): Promise<void> {
  if (isSharedRoutine(payload)) {
    const fresh = await freshSharedRoutine(target)
    if (fresh) {
      if (fresh.payload.definition.archived || !occurrenceStillOpen(fresh.payload, target.occurrenceKey)) return
      const context: RoutineReminderContext = {
        me: (await ensureKnownUserId()) ?? null,
        prefs: getSyncedPrefs().values,
        permissionOf: () => null,
      }
      if (!routineRemindsHere(fresh.task, fresh.payload, context)) return
    }
  }
  const config = loadConfig() || configSnapshot
  if (!config.notifications_enabled || !isRoutinesEnabled(config)) return
  const definition = payload.definition
  const notification = new Notification({
    title: followUp ? `Still pending: ${definition.name}` : definition.name,
    body: followUp ? 'A gentle follow-up' : 'Routine reminder',
    silent: !(config.notifications_task_reminder_sound ?? config.notifications_sound),
    timeoutType: (config.notifications_task_reminder_persistent ?? config.notifications_persistent) ? 'never' : 'default',
    icon: getIcon(),
  })
  attachNotificationDiagnostics(notification, `routine reminder (${definition.id})`)
  notification.on('click', () => {
    showMainWindow()
    mainWindowRef?.webContents.send('navigate', '/routines')
  })
  notification.show()
}

function localDateAtMinutes(value: string, minutes: number): Date {
  const date = startOfLocalDay(value)
  date.setHours(Math.max(0, Math.min(23, Math.floor(minutes / 60))), Math.max(0, Math.min(59, minutes % 60)), 0, 0)
  return date
}

function fireTaskReminder(taskId: number, title: string, configSnapshot: AppConfig): void {
  const config = loadConfig() || configSnapshot
  // The master toggle covers task reminders too (D-NOTIF-1).
  if (!config.notifications_enabled) return

  const notification = new Notification({
    title: `Reminder: ${title}`,
    body: 'Task reminder',
    silent: !(config.notifications_task_reminder_sound ?? config.notifications_sound),
    timeoutType: (config.notifications_task_reminder_persistent ?? config.notifications_persistent) ? 'never' : 'default',
    icon: getIcon(),
  })
  attachNotificationDiagnostics(notification, `task reminder (${taskId})`)

  notification.on('click', () => {
    showMainWindow()
    mainWindowRef?.webContents.send('navigate-to-task', taskId)
  })

  notification.show()
}

function scheduleAll(): void {
  const config = loadConfig()
  if (!config?.notifications_enabled) return

  if (config.notifications_daily_reminder_enabled) {
    scheduleReminder(
      config.notifications_daily_reminder_time || '08:00',
      (id) => { dailyTimerId = id },
      config,
    )
  }

  if (config.notifications_secondary_reminder_enabled) {
    scheduleReminder(
      config.notifications_secondary_reminder_time || '16:00',
      (id) => { secondaryTimerId = id },
      config,
    )
  }
}

function scheduleReminder(
  timeStr: string,
  setTimer: (id: ReturnType<typeof setTimeout>) => void,
  config: AppConfig,
): void {
  const ms = msUntilTime(timeStr)
  const id = setTimeout(() => {
    fireReminder(config)
    // Reschedule for next day
    scheduleReminder(timeStr, setTimer, config)
  }, ms)
  setTimer(id)
}

function msUntilTime(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const now = new Date()
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0)

  // If the target time has already passed today, schedule for tomorrow
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1)
  }

  return target.getTime() - now.getTime()
}

// --- Notification firing ---

async function fireReminder(configSnapshot: AppConfig): Promise<void> {
  // Re-read config in case it changed since scheduling
  const config = loadConfig() || configSnapshot

  if (!config.notifications_enabled) return

  const tasks = await getNotificationTasks(config)
  if (tasks.overdue.length === 0 && tasks.dueToday.length === 0 && tasks.upcoming.length === 0) {
    return
  }

  const allTasks = [...tasks.overdue, ...tasks.dueToday, ...tasks.upcoming]

  if (allTasks.length <= 3) {
    // Show individual notifications
    for (const task of allTasks) {
      showTaskNotification(task, config)
    }
  } else {
    // Show summary notification
    showSummaryNotification(tasks, config)
  }
}

// --- Task fetching ---

interface TaskInfo {
  id: number | string
  title: string
  due_date: string
  category: 'overdue' | 'due_today' | 'upcoming'
}

interface NotificationTasks {
  overdue: TaskInfo[]
  dueToday: TaskInfo[]
  upcoming: TaskInfo[]
}

async function getNotificationTasks(config: AppConfig): Promise<NotificationTasks> {
  const result: NotificationTasks = { overdue: [], dueToday: [], upcoming: [] }

  if (config.standalone_mode) {
    return getStandaloneNotificationTasks(config)
  }

  // Local-day boundaries, exclusive upper bounds (cross-app semantics v1, section 2).
  const filters = notificationFilters(new Date())

  // Fetch overdue tasks
  if (config.notifications_overdue_enabled) {
    const overdue = await fetchTasks({
      filter: filters.overdue,
      sort_by: 'due_date',
      order_by: 'asc',
      per_page: MAX_PAGE_SIZE,
    })
    if (overdue.success && Array.isArray(overdue.data)) {
      result.overdue = (overdue.data as Array<Record<string, unknown>>)
        .filter((t) => t.due_date && t.due_date !== NULL_DATE && !isHiddenTask(t.description as string | undefined))
        .map((t) => ({
          id: t.id as number,
          title: t.title as string,
          due_date: t.due_date as string,
          category: 'overdue' as const,
        }))
    }
  }

  // Fetch tasks due today
  if (config.notifications_due_today_enabled) {
    const dueToday = await fetchTasks({
      filter: filters.dueToday,
      sort_by: 'due_date',
      order_by: 'asc',
      per_page: MAX_PAGE_SIZE,
    })
    if (dueToday.success && Array.isArray(dueToday.data)) {
      result.dueToday = (dueToday.data as Array<Record<string, unknown>>)
        .filter((t) => t.due_date && t.due_date !== NULL_DATE && !isHiddenTask(t.description as string | undefined))
        .map((t) => ({
          id: t.id as number,
          title: t.title as string,
          due_date: t.due_date as string,
          category: 'due_today' as const,
        }))
    }
  }

  // Fetch upcoming tasks (tomorrow)
  if (config.notifications_upcoming_enabled) {
    const upcoming = await fetchTasks({
      filter: filters.upcoming,
      sort_by: 'due_date',
      order_by: 'asc',
      per_page: MAX_PAGE_SIZE,
    })
    if (upcoming.success && Array.isArray(upcoming.data)) {
      result.upcoming = (upcoming.data as Array<Record<string, unknown>>)
        .filter((t) => t.due_date && t.due_date !== NULL_DATE && !isHiddenTask(t.description as string | undefined))
        .map((t) => ({
          id: t.id as number,
          title: t.title as string,
          due_date: t.due_date as string,
          category: 'upcoming' as const,
        }))
    }
  }

  return result
}

function getStandaloneNotificationTasks(config: AppConfig): NotificationTasks {
  const result: NotificationTasks = { overdue: [], dueToday: [], upcoming: [] }
  const tasks = getAllStandaloneTasks()

  const now = new Date()

  for (const task of tasks) {
    if (task.due_date === NULL_DATE || !task.due_date) continue
    const category = notificationCategory(task.due_date, now)

    if (config.notifications_overdue_enabled && category === 'overdue') {
      result.overdue.push({
        id: task.id,
        title: task.title,
        due_date: task.due_date,
        category: 'overdue',
      })
    } else if (config.notifications_due_today_enabled && category === 'due_today') {
      result.dueToday.push({
        id: task.id,
        title: task.title,
        due_date: task.due_date,
        category: 'due_today',
      })
    } else if (config.notifications_upcoming_enabled && category === 'upcoming') {
      result.upcoming.push({
        id: task.id,
        title: task.title,
        due_date: task.due_date,
        category: 'upcoming',
      })
    }
  }

  return result
}

// --- Notification display ---

function showTaskNotification(task: TaskInfo, config: AppConfig): void {
  const notification = new Notification({
    title: task.title,
    body: formatDueDate(task.due_date, task.category),
    silent: !config.notifications_sound,
    timeoutType: config.notifications_persistent ? 'never' : 'default',
    icon: getIcon(),
  })
  attachNotificationDiagnostics(notification, `task notification (${task.id ?? 'unknown'})`)

  notification.on('click', () => {
    showMainWindow()
    if (typeof task.id === 'number') {
      mainWindowRef?.webContents.send('navigate-to-task', task.id)
    }
  })

  notification.show()
}

function showSummaryNotification(tasks: NotificationTasks, config: AppConfig): void {
  const overdueCount = tasks.overdue.length
  const dueTodayCount = tasks.dueToday.length
  const upcomingCount = tasks.upcoming.length
  const total = overdueCount + dueTodayCount + upcomingCount

  const parts: string[] = []
  if (dueTodayCount > 0) parts.push(`${dueTodayCount} due today`)
  if (overdueCount > 0) parts.push(`${overdueCount} overdue`)
  if (upcomingCount > 0) parts.push(`${upcomingCount} due tomorrow`)

  const notification = new Notification({
    title: `Vicu — ${total} task${total === 1 ? '' : 's'} need attention`,
    body: parts.join(', '),
    silent: !config.notifications_sound,
    timeoutType: config.notifications_persistent ? 'never' : 'default',
    icon: getIcon(),
  })
  attachNotificationDiagnostics(notification, 'summary notification')

  notification.on('click', () => {
    showMainWindow()
  })

  notification.show()
}

// --- Helpers ---

function formatDueDate(dueDateStr: string, category: 'overdue' | 'due_today' | 'upcoming'): string {
  if (category === 'due_today') return 'Due today'
  if (category === 'upcoming') return 'Due tomorrow'

  // Overdue: whole calendar days since the due date's local day
  const diffDays = overdueDays(dueDateStr)

  if (diffDays <= 0) return 'Due today'
  if (diffDays === 1) return 'Overdue by 1 day'
  return `Overdue by ${diffDays} days`
}

function getIcon(): Electron.NativeImage | undefined {
  try {
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, 'resources', 'icon.png')
      : join(app.getAppPath(), 'resources', 'icon.png')
    const icon = nativeImage.createFromPath(iconPath)
    return icon.isEmpty() ? undefined : icon
  } catch {
    return undefined
  }
}

function showMainWindow(): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.show()
    if (mainWindowRef.isMinimized()) mainWindowRef.restore()
    mainWindowRef.focus()
  }
}
