import type { TranslationKey } from '../../shared/i18n'
import type { TaskOrderKey } from '../../shared/task-order'

/** The names of the task orders (Sort tasks, Settings, Projects), by catalog key. */
export const TASK_ORDER_LABEL_KEYS: Record<TaskOrderKey, TranslationKey> = {
  due_date_first: 'settings.projects.order.dueDateFirst',
  due_date_priority: 'settings.projects.order.dueDatePriority',
  manual: 'settings.projects.order.manual',
  priority: 'settings.projects.order.priority',
  title: 'settings.projects.order.title',
  newest: 'settings.projects.order.newest',
  oldest: 'settings.projects.order.oldest',
}
