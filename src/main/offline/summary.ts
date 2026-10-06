import type { QueuedAction } from './types'

function quoted(title: string | undefined): string {
  return title ? `"${title}"` : ''
}

/** What to call the task an action belongs to: its title, else the title of its pending create, else its id. */
function taskLabel(action: QueuedAction, all: readonly QueuedAction[]): string {
  if (action.title) return quoted(action.title)
  if (action.type === 'create') return quoted(typeof action.fields.title === 'string' ? action.fields.title : undefined) || 'a new task'
  const create = all.find((a) => a.type === 'create' && a.tempId === action.taskId)
  if (create && create.type === 'create' && typeof create.fields.title === 'string') return quoted(create.fields.title)
  return action.taskId > 0 ? `task #${action.taskId}` : 'a new task'
}

const FIELD_NAMES: Record<string, string> = {
  title: 'title',
  description: 'description',
  due_date: 'due date',
  start_date: 'start date',
  end_date: 'end date',
  priority: 'priority',
  project_id: 'project',
  repeat_after: 'repeat',
  repeat_mode: 'repeat',
  reminders: 'reminders',
  hex_color: 'color',
  percent_done: 'progress',
  is_favorite: 'favorite',
}

/**
 * One line for the pending / failed lists. `all` is the whole queue, so a change to a task that
 * only exists as a pending create can still be named.
 */
export function describeAction(action: QueuedAction, all: readonly QueuedAction[] = []): string {
  const name = taskLabel(action, all)
  switch (action.type) {
    case 'create':
      return `Create ${name}${action.done ? ' (completed)' : ''}`
    case 'delete':
      return `Delete ${name}`
    case 'add-label':
      return `Add label ${quoted(action.labelTitle) || `#${action.labelId ?? '?'}`} to ${name}`
    case 'remove-label':
      return `Remove label #${action.labelId} from ${name}`
    case 'upload-attachment':
      return `Attach ${quoted(action.name) || 'a file'} to ${name}`
    case 'update': {
      const keys = Object.keys(action.patch)
      if (keys.length === 1 && keys[0] === 'done') return `${action.patch.done === true ? 'Complete' : 'Reopen'} ${name}`
      if (keys.length === 1 && keys[0] === 'due_date') {
        return action.patch.due_date === null ? `Remove the due date from ${name}` : `Set the due date of ${name}`
      }
      const fields = [...new Set(keys.map((k) => FIELD_NAMES[k] ?? k))]
      return `Update ${name}${fields.length ? ` (${fields.join(', ')})` : ''}`
    }
  }
}
