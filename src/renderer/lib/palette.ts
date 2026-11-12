import { fuzzyRank } from './fuzzy'
import type { Label, Project, Task } from './vikunja-types'

// What the command palette lists and how a query picks from it. Pure: the component turns an
// action into a navigation or a change.

export type PaletteCommand = 'new-task' | 'new-event' | 'voice' | 'dictate' | 'brain-dump' | 'ask' | 'make-tasks' | 'refresh' | 'toggle-theme' | 'settings'
  | 'pro-focus' | 'pro-settings' | 'pro-import' | 'pro-copilot' | 'pro-recap'

export type PaletteAction =
  | { type: 'command'; command: PaletteCommand }
  | { type: 'path'; path: string }
  | { type: 'project'; id: number }
  | { type: 'label'; id: number }
  | { type: 'task'; task: Task }

export type PaletteKind = 'Action' | 'List' | 'Guided' | 'Project' | 'Label' | 'Task'

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
  /** The Plan screen is on: "New event" is listed (calendar plan, phase 1). */
  planner?: boolean
  /** Pro's lists and actions while Pro is on (plan 7.1.11); absent while it is off. */
  pro?: ProPaletteSources
}

export interface ProPaletteSources {
  lists: readonly { id: string; label: string; path: string }[]
  focus: boolean
  promises: boolean
}

/** Pro's actions, by layer. */
export function proPaletteItems(pro: ProPaletteSources): PaletteItem[] {
  return [
    ...(pro.focus
      ? [{ id: 'cmd:pro-focus', kind: 'Action', title: 'Focus', keywords: 'pro show only projects categories narrow hide', action: { type: 'command', command: 'pro-focus' } } satisfies PaletteItem]
      : []),
    ...(pro.promises
      ? ([
          { id: 'cmd:pro-import', kind: 'Action', title: 'Import meeting notes', keywords: 'pro paste copilot json promises actions decisions', action: { type: 'command', command: 'pro-import' } },
          { id: 'cmd:pro-copilot', kind: 'Action', title: 'Ask Copilot', keywords: 'pro prompt meeting mail chat summary export', action: { type: 'command', command: 'pro-copilot' } },
          { id: 'cmd:pro-recap', kind: 'Action', title: 'Recap', keywords: 'pro summary send people promises meeting', action: { type: 'command', command: 'pro-recap' } },
        ] satisfies PaletteItem[])
      : []),
    { id: 'cmd:pro-settings', kind: 'Action', title: 'Pro settings', keywords: 'pro preferences layers area cap', action: { type: 'command', command: 'pro-settings' } },
    ...pro.lists.map((list): PaletteItem => ({ id: `list:${list.id}`, kind: 'List', title: list.label, keywords: 'go to pro', action: { type: 'path', path: list.path } })),
  ]
}

/** The guided sessions (cross-app semantics 14): found by name, not listed with an empty query. */
export const GUIDED_PALETTE_ITEMS: readonly PaletteItem[] = [
  { id: 'guided:inbox', kind: 'Guided', title: 'Sort the Inbox', keywords: 'guided organize organise process triage one at a time session', action: { type: 'path', path: '/guided/inbox' } },
  { id: 'guided:overdue', kind: 'Guided', title: 'Sort out overdue', keywords: 'guided organize organise late reschedule session', action: { type: 'path', path: '/guided/overdue' } },
  { id: 'guided:waiting', kind: 'Guided', title: 'Waiting a long time', keywords: 'guided organize organise old stale untouched session', action: { type: 'path', path: '/guided/waiting' } },
  { id: 'guided:review', kind: 'Guided', title: 'Start review', keywords: 'guided projects review one at a time session', action: { type: 'path', path: '/guided/review' } },
  { id: 'guided:weekly', kind: 'Guided', title: 'Weekly review', keywords: 'guided gtd checklist week session', action: { type: 'path', path: '/weekly-review' } },
]

/** Everything the palette can run except tasks: actions, smart lists, guided sessions, projects and labels, in that order. */
export function buildPaletteItems({ smartLists, projects, labels, planner = false, pro }: PaletteSources): PaletteItem[] {
  const actions: PaletteItem[] = [
    { id: 'cmd:new-task', kind: 'Action', title: 'New task', keywords: 'add create', action: { type: 'command', command: 'new-task' } },
    // An Event on the Plan screen (contract 20.3), at the selected day's next free time.
    ...(planner
      ? [{ id: 'cmd:new-event', kind: 'Action', title: 'New event', keywords: 'add create calendar meeting busy plan', action: { type: 'command', command: 'new-event' } } satisfies PaletteItem]
      : []),
    // Voice input that needs no holding (docs/voice-input.md): listening until Enter, Esc cancels.
    { id: 'cmd:voice', kind: 'Action', title: 'Say a task', keywords: 'voice dictate speak speech microphone add', action: { type: 'command', command: 'voice' } },
    // The AI assistant (docs/ai-assistant-v1.md): smart dictation with the microphone open, its
    // brain dump (organized at the end, 4.8), Ask, and dictation's "Make tasks from this".
    { id: 'cmd:dictate', kind: 'Action', title: 'Dictate tasks', keywords: 'assistant ai voice smart dictation speak several microphone', action: { type: 'command', command: 'dictate' } },
    { id: 'cmd:brain-dump', kind: 'Action', title: 'Brain dump', keywords: 'assistant ai voice dictation ramble organize organise projects think type', action: { type: 'command', command: 'brain-dump' } },
    { id: 'cmd:ask', kind: 'Action', title: 'Ask Vicu', keywords: 'assistant ai chat question talk', action: { type: 'command', command: 'ask' } },
    { id: 'cmd:make-tasks', kind: 'Action', title: 'Make tasks from text', keywords: 'assistant ai paste notes email split', action: { type: 'command', command: 'make-tasks' } },
    { id: 'cmd:refresh', kind: 'Action', title: 'Refresh', keywords: 'reload sync update', action: { type: 'command', command: 'refresh' } },
    { id: 'cmd:toggle-theme', kind: 'Action', title: 'Toggle theme', keywords: 'dark light mode', action: { type: 'command', command: 'toggle-theme' } },
    { id: 'cmd:settings', kind: 'Action', title: 'Settings', keywords: 'preferences options', action: { type: 'command', command: 'settings' } },
  ]
  return [
    ...actions,
    ...smartLists.map((list): PaletteItem => ({ id: `list:${list.id}`, kind: 'List', title: list.label, keywords: 'go to', action: { type: 'path', path: list.path } })),
    ...(pro ? proPaletteItems(pro) : []),
    ...GUIDED_PALETTE_ITEMS,
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
