import { describe, expect, it } from 'vitest'
import { parse } from '../task-parser'
import { composerChips, resolveComposerFields, type ComposerInput } from '../composer-fields'
import { parseChips, priorityChipName } from '../parse-chips'
import { dateOnlyDue } from '../due-dates'
import { NULL_DATE } from '../constants'

// Wednesday 7 October 2026, 10:30.
const NOW = new Date(2026, 9, 7, 10, 30)
const GB = { locale: 'en-GB', hour12: false }
const config = { enabled: true, syntaxMode: 'vikunja' as const, locale: 'en-GB' }
const PROJECTS: Record<string, number> = { personal: 12, work: 3 }

function input(text: string, over: Partial<ComposerInput> = {}): ComposerInput {
  return {
    parsed: text ? parse(text, config, NOW) : null,
    dueTouched: false,
    dueValue: null,
    contextDue: null,
    contextDueDismissed: false,
    priority: null,
    projectTouched: false,
    selectedProjectId: 5,
    findProjectId: (title) => PROJECTS[title.toLowerCase()],
    recurrenceTouched: false,
    repeatAfter: 0,
    repeatMode: 0,
    ...over,
  }
}

const SATURDAY_3PM = new Date(2026, 9, 10, 15, 0).toISOString()

describe('the text decides until a control is used', () => {
  it('reads the date, priority and project from the text', () => {
    const fields = resolveComposerFields(input('Call Ana saturday 3pm +Personal !3'))
    expect(fields.dueDate).toBe(SATURDAY_3PM)
    expect(fields.dueSource).toBe('text')
    expect(fields.priority).toBe(3)
    expect(fields.prioritySource).toBe('text')
    expect(fields.projectId).toBe(12)
    expect(fields.projectSource).toBe('text')
    expect(fields.projectNotFound).toBe(false)
  })

  it('a date without a time is date-only', () => {
    expect(resolveComposerFields(input('Call Ana saturday')).dueDate).toBe(dateOnlyDue('2026-10-10'))
  })

  it('a project the text names but that does not exist stays on the selected project and says so', () => {
    const fields = resolveComposerFields(input('Call Ana +Nowhere'))
    expect(fields.projectId).toBe(5)
    expect(fields.projectNotFound).toBe(true)
    const chips = composerChips({ fields, parsed: input('Call Ana +Nowhere').parsed, chipLabels: [], projectTitle: 'Inbox', fmt: GB, now: NOW })
    expect(chips.find((c) => c.type === 'project')!.label).toBe('Nowhere (no such project)')
  })

  it('does not call a project missing while its word is still being typed', () => {
    const typing = input('Call Ana +Pe')
    const fields = resolveComposerFields(typing)
    const chip = (text: string) => composerChips({ fields, parsed: typing.parsed, chipLabels: [], projectTitle: 'Inbox', fmt: GB, now: NOW, text }).find((c) => c.type === 'project')!.label
    expect(chip('Call Ana +Pe')).toBe('Pe')
    expect(chip('Call Ana +Pe ')).toBe('Pe (no such project)')
  })

  it('falls back to the list default date only when the text has none', () => {
    const base = { contextDue: dateOnlyDue('2026-10-07') }
    expect(resolveComposerFields(input('Call Ana', base))).toMatchObject({ dueDate: dateOnlyDue('2026-10-07'), dueSource: 'default' })
    expect(resolveComposerFields(input('Call Ana friday', base)).dueSource).toBe('text')
    expect(resolveComposerFields(input('Call Ana', { ...base, contextDueDismissed: true })).dueDate).toBeNull()
  })
})

describe('a control wins over the text', () => {
  it('the picked date wins, and clearing it keeps it cleared', () => {
    const picked = dateOnlyDue('2026-10-20')
    expect(resolveComposerFields(input('Call Ana saturday', { dueTouched: true, dueValue: picked }))).toMatchObject({ dueDate: picked, dueSource: 'chip' })
    expect(resolveComposerFields(input('Call Ana saturday', { dueTouched: true, dueValue: NULL_DATE })).dueDate).toBeNull()
    expect(resolveComposerFields(input('Call Ana saturday', { dueTouched: true, dueValue: null })).dueDate).toBeNull()
  })

  it('the picked priority wins, including none', () => {
    expect(resolveComposerFields(input('Call !3', { priority: 1 }))).toMatchObject({ priority: 1, prioritySource: 'chip' })
    expect(resolveComposerFields(input('Call !3', { priority: 0 }))).toMatchObject({ priority: 0, prioritySource: null })
  })

  it('the picked project wins', () => {
    expect(resolveComposerFields(input('Call +Personal', { projectTouched: true, selectedProjectId: 3 }))).toMatchObject({ projectId: 3, projectSource: 'chip' })
  })

  it('the picked repeat wins, and a monthly repeat counts as a chip', () => {
    const fields = resolveComposerFields(input('Water plants every day', { recurrenceTouched: true, repeatAfter: 0, repeatMode: 1 }))
    expect(fields.repeat).toEqual({ repeat_after: 0, repeat_mode: 1 })
    expect(fields.repeatSource).toBe('chip')
    expect(resolveComposerFields(input('Water plants every day')).repeat).toEqual({ repeat_after: 86400, repeat_mode: 0 })
  })
})

describe('chips show what is saved', () => {
  const chipsFor = (text: string, over: Partial<ComposerInput> = {}, extra: { chipLabels?: string[]; projectTitle?: string } = {}) => {
    const i = input(text, over)
    const fields = resolveComposerFields(i)
    return composerChips({ fields, parsed: i.parsed, chipLabels: extra.chipLabels ?? [], projectTitle: extra.projectTitle ?? 'Personal', fmt: GB, now: NOW })
  }

  it('shows the coming Saturday at 15:00, the project and the priority name', () => {
    const chips = chipsFor('Call Ana saturday 3pm +Personal !3')
    expect(chips.map((c) => [c.type, c.label, c.source])).toEqual([
      ['date', 'Sat 10 Oct, 15:00', 'text'],
      ['priority', 'High', 'text'],
      ['project', 'Personal', 'text'],
    ])
  })

  it('shows the control value, not the text, once a control is used', () => {
    const chips = chipsFor('Call Ana saturday 3pm !3', { dueTouched: true, dueValue: dateOnlyDue('2026-10-20'), priority: 1 })
    expect(chips.map((c) => [c.type, c.label, c.source])).toEqual([
      ['date', 'Tue 20 Oct', 'chip'],
      ['priority', 'Low', 'chip'],
    ])
  })

  it('lists picked and typed labels once each', () => {
    const chips = chipsFor('Call *errand *call', {}, { chipLabels: ['Errand', 'waiting'] })
    expect(chips.filter((c) => c.type === 'label').map((c) => [c.label, c.source])).toEqual([
      ['Errand', 'chip'],
      ['waiting', 'chip'],
      ['call', 'text'],
    ])
  })

  it('has no chip for a default date from the list', () => {
    expect(chipsFor('Call Ana', { contextDue: dateOnlyDue('2026-10-07') })).toEqual([])
  })

  it('has no chips for plain text', () => {
    expect(chipsFor('Call Ana')).toEqual([])
  })
})

describe('parse chips', () => {
  it('name the priorities the same everywhere', () => {
    expect([1, 2, 3, 4, 5].map(priorityChipName)).toEqual(['Low', 'Medium', 'High', 'Urgent', 'Do now'])
  })

  it('turn a parse into chips in a fixed order', () => {
    const result = parse('Call Ana saturday 3pm +Personal *call !4 every week', config, NOW)
    expect(parseChips(result, GB, NOW).map((c) => [c.type, c.label])).toEqual([
      ['date', 'Sat 10 Oct, 15:00'],
      ['priority', 'Urgent'],
      ['label', 'call'],
      ['project', 'Personal'],
      ['recurrence', 'Every week'],
    ])
  })
})
