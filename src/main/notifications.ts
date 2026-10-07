import { app, Notification, nativeImage, BrowserWindow } from 'electron'
import { join } from 'path'
import { loadConfig, type AppConfig } from './config'
import { MAX_PAGE_SIZE } from './api-v2'
import { fetchTaskById, fetchTasks } from './api-client'
import { loadRoutineCarriers } from './carrier-service'
import { getAllStandaloneTasks } from './cache'
import { getOfflineQueue } from './offline/service'
import { createTaskReminderScheduler } from './task-reminders'
import { notificationCategory, notificationFilters, overdueDays } from './notification-windows'
import { addLocalDays, startOfLocalDay, toLocalDate } from '../shared/due-dates'
import { parseRoutineEnvelope, routineOccurrenceKey, scheduledDateOn, type RoutinePayload } from '../shared/routines'

const NULL_DATE = '0001-01-01T00:00:00Z'

// Active timer IDs so we can cancel on reschedule
let dailyTimerId: ReturnType<typeof setTimeout> | null = null
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
  if (!config?.notifications_enabled || config.standalone_mode) return

  // Carriers are fetched by their remembered ids; the done tasks are not listed (D-NOTIF-3).
  const result = await loadRoutineCarriers()
  if (!result.success) return
  const now = Date.now()
  const today = toLocalDate(new Date())

  for (const task of result.data as unknown as Array<Record<string, unknown>>) {
    // Archive parts and malformed carriers have no payload and are skipped here.
    const payload = parseRoutineEnvelope(typeof task.description === 'string' ? task.description : '').payload
    if (!payload || payload.definition.archived) continue
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
        scheduleRoutineTimer(`${key}:primary`, base, now, payload, slot.label, false, config)
        if (slot.followUpMinutes > 0) {
          scheduleRoutineTimer(`${key}:followup`, base + slot.followUpMinutes * 60_000, now, payload, slot.label, true, config)
        }
      }
    }
  }
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

function clearTimers(): void {
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

function scheduleRoutineTimer(
  key: string,
  triggerAt: number,
  now: number,
  payload: RoutinePayload,
  slotLabel: string,
  followUp: boolean,
  config: AppConfig,
): void {
  const delay = triggerAt - now
  if (delay <= 0 || delay > 2_147_483_647 || routineReminderTimers.has(key)) return
  const timerId = setTimeout(() => {
    fireRoutineReminder(payload, slotLabel, followUp, config)
    routineReminderTimers.delete(key)
  }, delay)
  routineReminderTimers.set(key, timerId)
}

function fireRoutineReminder(
  payload: RoutinePayload,
  slotLabel: string,
  followUp: boolean,
  configSnapshot: AppConfig,
): void {
  const config = loadConfig() || configSnapshot
  if (!config.notifications_enabled) return
  const definition = payload.definition
  const amount = [definition.amount, definition.unit].filter(Boolean).join(' ')
  const notification = new Notification({
    title: followUp ? `Still pending: ${definition.name}` : definition.name,
    body: [amount, slotLabel, followUp ? 'A gentle follow-up' : definition.kind === 'CHORE' ? 'Chore reminder' : 'Routine reminder'].filter(Boolean).join(' / '),
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
        .filter((t) => t.due_date && t.due_date !== NULL_DATE)
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
        .filter((t) => t.due_date && t.due_date !== NULL_DATE)
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
        .filter((t) => t.due_date && t.due_date !== NULL_DATE)
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
