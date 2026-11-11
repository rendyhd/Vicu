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
  it('lists actions first, then smart lists, guided sessions, projects and labels', () => {
    expect(ids(items).map((id) => id.split(':')[0])).toEqual(['cmd', 'cmd', 'cmd', 'cmd', 'cmd', 'cmd', 'cmd', 'cmd', 'cmd', 'list', 'list', 'list', 'guided', 'guided', 'guided', 'guided', 'guided', 'project', 'project', 'label'])
  })

  it('lists New event after New task only while the Plan screen is on', () => {
    expect(items.some((i) => i.id === 'cmd:new-event')).toBe(false)
    const planner = buildPaletteItems({ smartLists: [], projects: [], labels: [], planner: true })
    expect(planner.slice(0, 2).map((i) => i.title)).toEqual(['New task', 'New event'])
    expect(rankPalette(planner, 'new event', [])[0].id).toBe('cmd:new-event')
    expect(rankPalette(planner, 'meeting', []).map((i) => i.id)).toContain('cmd:new-event')
  })

  it('has the New task, Say a task, Dictate tasks, Brain dump, Ask, Make tasks, Refresh, Toggle theme and Settings actions', () => {
    expect(items.filter((i) => i.kind === 'Action').map((i) => i.title)).toEqual(['New task', 'Say a task', 'Dictate tasks', 'Brain dump', 'Ask Vicu', 'Make tasks from text', 'Refresh', 'Toggle theme', 'Settings'])
  })
})

describe('rankPalette', () => {
  it('shows only actions and smart lists with no query', () => {
    const shown = rankPalette(items, '', [task(1, 'x')])
    expect(shown.every((i) => i.kind === 'Action' || i.kind === 'List')).toBe(true)
    expect(shown).toHaveLength(12)
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

  it('finds Say a task by voice words, and Dictate tasks by its name', () => {
    expect(rankPalette(items, 'say', [])[0].id).toBe('cmd:voice')
    expect(rankPalette(items, 'dictate', [])[0].id).toBe('cmd:dictate')
    expect(rankPalette(items, 'dictate', []).map((i) => i.id)).toContain('cmd:voice')
  })

  it('finds the guided sessions by name and by their words', () => {
    expect(rankPalette(items, 'weekly review', [])[0].id).toBe('guided:weekly')
    expect(rankPalette(items, 'sort the inbox', [])[0].id).toBe('guided:inbox')
    expect(rankPalette(items, 'triage', []).map((i) => i.id)).toEqual(['guided:inbox'])
  })

  it('lists nothing when nothing matches', () => {
    expect(rankPalette(items, 'zzzz', [])).toEqual([])
  })
})
