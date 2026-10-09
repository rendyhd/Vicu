import { describe, expect, it } from 'vitest'
import { PALETTE_COMMAND_LIMIT, PALETTE_TASK_LIMIT, buildPaletteItems, rankPalette } from '../palette'
import type { Task } from '../vikunja-types'

const items = buildPaletteItems({
  smartLists: [
    { id: 'inbox', label: 'Inbox', path: '/inbox' },
    { id: 'today', label: 'Today', path: '/today' },
    { id: 'logbook', label: 'Logbook', path: '/logbook' },
  ],
  projects: [
    { id: 1, title: 'Work' },
    { id: 2, title: 'Home renovation' },
  ],
  labels: [{ id: 5, title: 'errand' }],
})
const task = (id: number, title: string) => ({ id, title, project_id: 1 }) as Task
const ids = (list: { id: string }[]) => list.map((i) => i.id)

describe('buildPaletteItems', () => {
  it('lists actions first, then smart lists, projects and labels', () => {
    expect(ids(items).map((id) => id.split(':')[0])).toEqual(['cmd', 'cmd', 'cmd', 'list', 'list', 'list', 'project', 'project', 'label'])
  })

  it('has the New task, Toggle theme and Settings actions', () => {
    expect(items.filter((i) => i.kind === 'Action').map((i) => i.title)).toEqual(['New task', 'Toggle theme', 'Settings'])
  })
})

describe('rankPalette', () => {
  it('shows only actions and smart lists with no query', () => {
    const shown = rankPalette(items, '', [task(1, 'x')])
    expect(shown.every((i) => i.kind === 'Action' || i.kind === 'List')).toBe(true)
    expect(shown).toHaveLength(6)
  })

  it('puts the Logbook list first for "logbook"', () => {
    expect(rankPalette(items, 'logbook', [])[0].id).toBe('list:logbook')
  })

  it('finds a project, a label and an action by name', () => {
    expect(rankPalette(items, 'reno', [])[0].id).toBe('project:2')
    expect(rankPalette(items, 'errand', [])[0].id).toBe('label:5')
    expect(rankPalette(items, 'theme', [])[0].id).toBe('cmd:toggle-theme')
  })

  it('matches hidden keywords only when the title does not match', () => {
    expect(rankPalette(items, 'dark', []).map((i) => i.id)).toContain('cmd:toggle-theme')
    const goTo = rankPalette(items, 'go to', []).map((i) => i.id)
    expect(goTo).toContain('list:today')
    expect(goTo).not.toContain('cmd:settings')
  })

  it('adds the matching tasks after the commands, a few at most', () => {
    const tasks = Array.from({ length: 9 }, (_, i) => task(i + 1, `Logbook entry ${i}`))
    const shown = rankPalette(items, 'logbook', tasks)
    expect(shown[0].id).toBe('list:logbook')
    expect(shown.filter((i) => i.kind === 'Task')).toHaveLength(PALETTE_TASK_LIMIT)
    expect(shown.length).toBeLessThanOrEqual(PALETTE_COMMAND_LIMIT + PALETTE_TASK_LIMIT)
  })

  it('lists nothing when nothing matches', () => {
    expect(rankPalette(items, 'zzzz', [])).toEqual([])
  })
})
