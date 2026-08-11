import { app, Notification, nativeImage, BrowserWindow } from 'electron'
import { join } from 'path'
import { loadConfig, type AppConfig } from './config'
import { fetchTasks } from './api-client'
import { getAllStandaloneTasks } from './cache'

const NULL_DATE = '0001-01-01T00:00:00Z'

// Active timer IDs so we can cancel on reschedule
let dailyTimerId: ReturnType<typeof setTimeout> | null = null
let secondaryTimerId: ReturnType<typeof setTimeout> | null = null
let routineRefreshTimerId: ReturnType<typeof setTimeout> | null = null

// Per-task reminder timers (key: "taskId-timestamp")
const reminderTimers = new Map<string, ReturnType<typeof setTimeout>>()
const routineReminderTimers = new Map<string, ReturnType<typeof setTimeout>>()

// Reference to main window (set during init)
let mainWindowRef: BrowserWindow | null = null

// --- Public API ---

export function initNotifications(mainWindow: BrowserWindow | null): void {
  mainWindowRef = mainWindow
  scheduleAll()
  refreshTaskReminders()
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
  refreshTaskReminders()
  refreshRoutineReminders()
  scheduleRoutineRefresh()
}

export function stopNotifications(): void {
  clearTimers()
  clearReminderTimers()
  clearRoutineReminderTimers()
}

interface RoutineNotificationPayload {
  definition: {
    id: string
    name: string
    kind: 'HEALTH' | 'CHORE'
    amount: string
    unit: string
    archived: boolean
    activeFrom: string
    schedule:
      | { type: 'calendar'; weekdays: number[]; weekInterval: number; anchorDate: string }
      | { type: 'after_completion'; intervalDays: number; firstDueDate: string }
    slots: Array<{
      id: string
      label: string
      reminderMinutes: number
      reminderEnabled: boolean
      followUpMinutes: number
    }>
  }
  occurrences: Record<string, {
    scheduledDate: string
    status: 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'NOT_LOGGED'
  }>
}

/** Schedule the next three weeks of routine alarms stored in hidden carrier tasks. */
export async function refreshRoutineReminders(): Promise<void> {
  clearRoutineReminderTimers()
  const config = loadConfig()
  if (!config?.notifications_enabled || config.standalone_mode) return

  const result = await fetchTasks({ per_page: 200, filter: 'done = true' })
  if (!result.success || !Array.isArray(result.data)) return
  const now = Date.now()
  const today = localDateString(new Date())

  for (const task of result.data as Array<Record<string, unknown>>) {
    const payload = parseRoutinePayload(task.description)
    if (!payload || payload.definition.archived) continue
    for (let offset = 0; offset <= 21; offset += 1) {
      const candidate = addLocalDays(today, offset)
      const scheduledDate = scheduledRoutineDate(payload, candidate)
      if (!scheduledDate || scheduledDate < payload.definition.activeFrom) continue
      for (const slot of payload.definition.slots) {
        if (!slot.reminderEnabled) continue
        const key = `${payload.definition.id}:${scheduledDate}:${slot.id}`
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

export async function refreshTaskReminders(): Promise<void> {
  clearReminderTimers()

  const config = loadConfig()
  if (!config || config.standalone_mode) return

  const result = await fetchTasks({ per_page: 200, filter: 'done = false' })
  if (!result.success || !Array.isArray(result.data)) return

  const tasks = result.data as Array<Record<string, unknown>>
  const now = Date.now()

  for (const task of tasks) {
    const reminders = task.reminders as Array<{ reminder: string }> | null | undefined
    if (!reminders || !Array.isArray(reminders)) continue

    const taskId = task.id as number
    const taskTitle = task.title as string

    for (const r of reminders) {
      if (!r.reminder) continue
      const reminderTime = new Date(r.reminder).getTime()
      if (isNaN(reminderTime) || reminderTime <= now) continue

      const key = `${taskId}-${r.reminder}`
      const delay = reminderTime - now
      // setTimeout uses a 32-bit signed int internally; delays > 2^31-1 ms (~24.85 days)
      // overflow and fire immediately. Skip far-future reminders — they'll be picked up
      // on a future refresh once they're within range.
      if (delay > 2_147_483_647) continue
      const timerId = setTimeout(() => {
        fireTaskReminder(taskId, taskTitle, config)
        reminderTimers.delete(key)
      }, delay)
      reminderTimers.set(key, timerId)
    }
  }
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

function clearReminderTimers(): void {
  for (const timerId of reminderTimers.values()) {
    clearTimeout(timerId)
  }
  reminderTimers.clear()
}

function clearRoutineReminderTimers(): void {
  for (const timerId of routineReminderTimers.values()) clearTimeout(timerId)
  routineReminderTimers.clear()
}

function scheduleRoutineTimer(
  key: string,
  triggerAt: number,
  now: number,
  payload: RoutineNotificationPayload,
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
  payload: RoutineNotificationPayload,
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
  notification.on('click', () => {
    showMainWindow()
    mainWindowRef?.webContents.send('navigate', '/routines')
  })
  notification.show()
}

function parseRoutinePayload(description: unknown): RoutineNotificationPayload | null {
  if (typeof description !== 'string') return null
  const marker = description.match(/<!--\s*vicu-routine:v1:([A-Za-z0-9_-]+={0,2})\s*-->/)
  if (!marker) return null
  try {
    const payload = JSON.parse(Buffer.from(marker[1], 'base64url').toString('utf8')) as RoutineNotificationPayload
    if (!payload?.definition?.id || !Array.isArray(payload.definition.slots)) return null
    return payload
  } catch {
    return null
  }
}

function localDateString(date: Date): string {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

function addLocalDays(value: string, days: number): string {
  const date = parseLocalDate(value)
  date.setDate(date.getDate() + days)
  return localDateString(date)
}

function isoWeekday(value: string): number {
  return parseLocalDate(value).getDay() || 7
}

function isoWeekStart(value: string): Date {
  const date = parseLocalDate(value)
  date.setDate(date.getDate() + 1 - (date.getDay() || 7))
  return date
}

function scheduledRoutineDate(payload: RoutineNotificationPayload, candidate: string): string | null {
  const { schedule } = payload.definition
  if (schedule.type === 'calendar') {
    if (candidate < schedule.anchorDate) return null
    if (schedule.weekdays.length > 0 && !schedule.weekdays.includes(isoWeekday(candidate))) return null
    const weeks = Math.round((isoWeekStart(candidate).getTime() - isoWeekStart(schedule.anchorDate).getTime()) / (7 * 86_400_000))
    return weeks % Math.max(1, schedule.weekInterval) === 0 ? candidate : null
  }
  const latest = Object.values(payload.occurrences)
    .filter((record) => record.status === 'COMPLETED')
    .map((record) => record.scheduledDate)
    .sort()
    .at(-1)
  const due = latest ? addLocalDays(latest, Math.max(1, schedule.intervalDays)) : schedule.firstDueDate
  return candidate === due ? due : null
}

function localDateAtMinutes(value: string, minutes: number): Date {
  const date = parseLocalDate(value)
  date.setHours(Math.max(0, Math.min(23, Math.floor(minutes / 60))), Math.max(0, Math.min(59, minutes % 60)), 0, 0)
  return date
}

function fireTaskReminder(taskId: number, title: string, configSnapshot: AppConfig): void {
  const config = loadConfig() || configSnapshot

  const notification = new Notification({
    title: `Reminder: ${title}`,
    body: 'Task reminder',
    silent: !(config.notifications_task_reminder_sound ?? config.notifications_sound),
    timeoutType: (config.notifications_task_reminder_persistent ?? config.notifications_persistent) ? 'never' : 'default',
    icon: getIcon(),
  })

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

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
  const tomorrowStart = new Date(todayStart)
  tomorrowStart.setDate(tomorrowStart.getDate() + 1)
  const tomorrowEnd = new Date(todayEnd)
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1)

  // Fetch overdue tasks
  if (config.notifications_overdue_enabled) {
    const overdue = await fetchTasks({
      filter: `done = false && due_date < "${todayStart.toISOString()}" && due_date != "${NULL_DATE}"`,
      sort_by: 'due_date',
      order_by: 'asc',
      per_page: 50,
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
      filter: `done = false && due_date >= "${todayStart.toISOString()}" && due_date <= "${todayEnd.toISOString()}"`,
      sort_by: 'due_date',
      order_by: 'asc',
      per_page: 50,
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
      filter: `done = false && due_date >= "${tomorrowStart.toISOString()}" && due_date <= "${tomorrowEnd.toISOString()}"`,
      sort_by: 'due_date',
      order_by: 'asc',
      per_page: 50,
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
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
  const tomorrowStart = new Date(todayStart)
  tomorrowStart.setDate(tomorrowStart.getDate() + 1)
  const tomorrowEnd = new Date(todayEnd)
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1)

  for (const task of tasks) {
    if (task.due_date === NULL_DATE || !task.due_date) continue
    const dueTime = new Date(task.due_date).getTime()

    if (config.notifications_overdue_enabled && dueTime < todayStart.getTime()) {
      result.overdue.push({
        id: task.id,
        title: task.title,
        due_date: task.due_date,
        category: 'overdue',
      })
    } else if (config.notifications_due_today_enabled && dueTime >= todayStart.getTime() && dueTime <= todayEnd.getTime()) {
      result.dueToday.push({
        id: task.id,
        title: task.title,
        due_date: task.due_date,
        category: 'due_today',
      })
    } else if (config.notifications_upcoming_enabled && dueTime >= tomorrowStart.getTime() && dueTime <= tomorrowEnd.getTime()) {
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

  notification.on('click', () => {
    showMainWindow()
  })

  notification.show()
}

// --- Helpers ---

function formatDueDate(dueDateStr: string, category: 'overdue' | 'due_today' | 'upcoming'): string {
  if (category === 'due_today') return 'Due today'
  if (category === 'upcoming') return 'Due tomorrow'

  // Overdue — calculate how many days
  const dueDate = new Date(dueDateStr)
  const now = new Date()
  const diffMs = now.getTime() - dueDate.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

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
