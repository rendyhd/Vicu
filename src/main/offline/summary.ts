import type { QueuedAction } from './types'

function quoted(title: string | undefined): string {
  return title ? `"${title}"` : ''
}

/** Temp id -> title of the pending create, so a change to a task that does not exist yet can still be named. */
export function pendingCreateTitles(actions: readonly QueuedAction[]): Map<number, string> {
  const titles = new Map<number, string>()
  for (const a of actions) {
    if (a.type === 'create' && typeof a.fields.title === 'string') titles.set(a.tempId, a.fields.title)
  }
  return titles
}

/** What to call the task an action belongs to: its title, else the title of its pending create, else its id. */
function taskLabel(action: QueuedAction, titles: ReadonlyMap<number, string>): string {
  if (action.type === 'create') {
    return quoted(typeof action.fields.title === 'string' ? action.fields.title : action.title) || 'a new task'
  }
  if (action.title) return quoted(action.title)
  const pendingTitle = titles.get(action.taskId)
  if (pendingTitle) return quoted(pendingTitle)
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

/** One line for the pending / failed lists. `titles` comes from `pendingCreateTitles`. */
export function describeAction(action: QueuedAction, titles: ReadonlyMap<number, string> = new Map()): string {
  const name = taskLabel(action, titles)
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
