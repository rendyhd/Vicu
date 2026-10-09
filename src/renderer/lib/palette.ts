import { fuzzyRank } from './fuzzy'
import type { Label, Project, Task } from './vikunja-types'

// What the command palette lists and how a query picks from it. Pure: the component turns an
// action into a navigation or a change.

export type PaletteCommand = 'new-task' | 'toggle-theme' | 'settings'

export type PaletteAction =
  | { type: 'command'; command: PaletteCommand }
  | { type: 'path'; path: string }
  | { type: 'project'; id: number }
  | { type: 'label'; id: number }
  | { type: 'task'; task: Task }

export type PaletteKind = 'Action' | 'List' | 'Project' | 'Label' | 'Task'

export interface PaletteItem {
  id: string
  kind: PaletteKind
  title: string
  /** Extra words the query may match without being shown ("go to"). */
  keywords: string
  action: PaletteAction
}

/** Most commands the palette lists, and most tasks added after them. */
export const PALETTE_COMMAND_LIMIT = 8
export const PALETTE_TASK_LIMIT = 5

export interface PaletteSources {
  smartLists: readonly { id: string; label: string; path: string }[]
  projects: readonly Pick<Project, 'id' | 'title'>[]
  labels: readonly Pick<Label, 'id' | 'title'>[]
}

/** Everything the palette can run except tasks: actions, smart lists, projects and labels, in that order. */
export function buildPaletteItems({ smartLists, projects, labels }: PaletteSources): PaletteItem[] {
  const actions: PaletteItem[] = [
    { id: 'cmd:new-task', kind: 'Action', title: 'New task', keywords: 'add create', action: { type: 'command', command: 'new-task' } },
    { id: 'cmd:toggle-theme', kind: 'Action', title: 'Toggle theme', keywords: 'dark light mode', action: { type: 'command', command: 'toggle-theme' } },
    { id: 'cmd:settings', kind: 'Action', title: 'Settings', keywords: 'preferences options', action: { type: 'command', command: 'settings' } },
  ]
  return [
    ...actions,
    ...smartLists.map((list): PaletteItem => ({ id: `list:${list.id}`, kind: 'List', title: list.label, keywords: 'go to', action: { type: 'path', path: list.path } })),
    ...projects.map((project): PaletteItem => ({ id: `project:${project.id}`, kind: 'Project', title: project.title, keywords: 'go to', action: { type: 'project', id: project.id } })),
    ...labels.map((label): PaletteItem => ({ id: `label:${label.id}`, kind: 'Label', title: label.title, keywords: 'go to tag', action: { type: 'label', id: label.id } })),
  ]
}

export function taskItem(task: Task): PaletteItem {
  return { id: `task:${task.id}`, kind: 'Task', title: task.title, keywords: '', action: { type: 'task', task } }
}

/**
 * What to list for a query. No query: the actions and smart lists. Otherwise the commands that
 * match, best first, then the matching tasks (already ranked by the caller).
 */
export function rankPalette(items: readonly PaletteItem[], query: string, tasks: readonly Task[]): PaletteItem[] {
  if (query.trim() === '') {
    return items.filter((item) => item.kind === 'Action' || item.kind === 'List').slice(0, PALETTE_COMMAND_LIMIT + PALETTE_TASK_LIMIT)
  }
  // The title carries the match; the hidden keywords only help when the title does not match at all.
  const byTitle = fuzzyRank(items, query, (item) => item.title)
  const titled = new Set(byTitle.map((r) => r.item.id))
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const byKeyword = items
    .filter((item) => !titled.has(item.id) && terms.every((term) => item.keywords.split(' ').some((word) => word.startsWith(term))))
    .map((item) => ({ item }))
  const commands = [...byTitle, ...byKeyword].map((r) => r.item).slice(0, PALETTE_COMMAND_LIMIT)
  return [...commands, ...tasks.slice(0, PALETTE_TASK_LIMIT).map(taskItem)]
}
