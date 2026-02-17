import { Notification, nativeImage, BrowserWindow } from 'electron'
import { join } from 'path'
import { loadConfig, type AppConfig } from './config'
import { fetchTasks } from './api-client'
import { getAllStandaloneTasks } from './cache'

const NULL_DATE = '0001-01-01T00:00:00Z'

// Active timer IDs so we can cancel on reschedule
let dailyTimerId: ReturnType<typeof setTimeout> | null = null
let secondaryTimerId: ReturnType<typeof setTimeout> | null = null

// Reference to main window (set during init)
let mainWindowRef: BrowserWindow | null = null

// --- Public API ---

export function initNotifications(mainWindow: BrowserWindow | null): void {
  mainWindowRef = mainWindow
  scheduleAll()
}

export function rescheduleNotifications(): void {
  clearTimers()
  scheduleAll()
}

export function stopNotifications(): void {
  clearTimers()
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
    const iconPath = join(__dirname, '../../resources/icon.png')
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
