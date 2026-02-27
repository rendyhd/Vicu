import type { TaskReminder, AppConfig } from './vikunja-types'
import { NULL_DATE } from './constants'

export function buildDefaultReminder(
  dueDate: string,
  config: AppConfig
): TaskReminder | null {
  const offset = config.notifications_default_reminder_offset
  if (offset === undefined || offset === 0) return null

  if (!dueDate || dueDate === NULL_DATE) return null

  const relativeTo = config.notifications_default_reminder_relative_to || 'due_date'

  // offset === -1 is the sentinel for "At due time" (relative_period: 0)
  if (offset === -1) {
    return {
      reminder: dueDate,
      relative_period: 0,
      relative_to: relativeTo,
    }
  }

  // offset > 0 means "X seconds before"
  return {
    reminder: new Date(new Date(dueDate).getTime() - offset * 1000).toISOString(),
    relative_period: -offset,
    relative_to: relativeTo,
  }
}
