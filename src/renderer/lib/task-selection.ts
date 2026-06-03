import type { QueryClient } from '@tanstack/react-query'
import type { Task } from '@/lib/vikunja-types'
import type { SectionData } from '@/hooks/use-project-sections'

/**
 * Visible task rows in document (visual) order. The only elements carrying
 * `data-task-id` are TaskRow's collapsed row and expanded card, so this returns
 * exactly the visible tasks across the parent list and every section — the
 * source of truth for shift-range, select-all, and copy ordering. (The outer
 * TaskList's `tasks` prop omits section tasks, so we can't use that.)
 */
export function orderedTaskIds(): number[] {
  const ids: number[] = []
  const seen = new Set<number>()
  document.querySelectorAll('[data-task-id]').forEach((el) => {
    const id = Number(el.getAttribute('data-task-id'))
    if (!Number.isNaN(id) && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  })
  return ids
}

/**
 * Resolve selected ids to full Task objects by scanning the same three TanStack
 * cache families the mutations read: ['tasks'] (smart lists/search),
 * ['view-tasks'] (inbox/project list), and ['section-tasks'] (sub-project
 * sections). Deduped by id; returns the tasks that resolve.
 */
export function resolveSelectedTasks(qc: QueryClient, ids: Set<number>): Task[] {
  if (ids.size === 0) return []
  const map = new Map<number, Task>()

  const flat = [
    ...qc.getQueriesData<Task[]>({ queryKey: ['tasks'] }),
    ...qc.getQueriesData<Task[]>({ queryKey: ['view-tasks'] }),
  ]
  for (const [, data] of flat) {
    if (!data) continue
    for (const t of data) {
      if (ids.has(t.id) && !map.has(t.id)) map.set(t.id, t)
    }
  }

  for (const [, sections] of qc.getQueriesData<SectionData[]>({ queryKey: ['section-tasks'] })) {
    if (!sections) continue
    for (const s of sections) {
      for (const t of s.tasks) {
        if (ids.has(t.id) && !map.has(t.id)) map.set(t.id, t)
      }
    }
  }

  const result: Task[] = []
  for (const id of ids) {
    const t = map.get(id)
    if (t) result.push(t)
  }
  return result
}

/**
 * Copy the selected tasks' titles to the clipboard, one per line, in visual
 * order. Uses CRLF on Windows so the text pastes with real line breaks into any
 * editor (including older Notepad).
 */
export async function copySelectedTitles(qc: QueryClient, ids: Set<number>): Promise<void> {
  if (ids.size === 0) return
  const byId = new Map(resolveSelectedTasks(qc, ids).map((t) => [t.id, t]))
  const titles: string[] = []
  const used = new Set<number>()
  // DOM order first (what the user sees)…
  for (const id of orderedTaskIds()) {
    if (!ids.has(id)) continue
    const t = byId.get(id)
    if (t) {
      titles.push(t.title)
      used.add(id)
    }
  }
  // …then any selected tasks not currently in the DOM (defensive).
  for (const [id, t] of byId) {
    if (!used.has(id)) titles.push(t.title)
  }
  if (titles.length === 0) return
  const sep = window.api.platform === 'win32' ? '\r\n' : '\n'
  await navigator.clipboard.writeText(titles.join(sep))
}
