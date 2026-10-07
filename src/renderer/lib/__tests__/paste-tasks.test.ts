import { describe, expect, it, vi } from 'vitest'
import { NULL_DATE } from '../constants'
import { dateOnlyDue, localDateOf } from '../due-dates'
import {
  createPastedTasks,
  pasteConfirmMessage,
  planPastedTask,
  splitPastedLines,
  type PastedTaskPlan,
  type PasteContext,
} from '../paste-tasks'

// Tue 2026-10-06 10:00 local, the reference time of the shared parser corpus.
const NOW = new Date(2026, 9, 6, 10, 0, 0)

const projects = [
  { id: 1, title: 'Inbox' },
  { id: 2, title: 'Work' },
]

const context = (overrides: Partial<PasteContext> = {}): PasteContext => ({
  projectId: 1,
  projects,
  parserConfig: { enabled: true, syntaxMode: 'todoist', bangToday: true, locale: 'en-US' },
  now: NOW,
  ...overrides,
})

describe('splitPastedLines', () => {
  it('has no lines for text without content', () => {
    expect(splitPastedLines('')).toEqual([])
    expect(splitPastedLines('   ')).toEqual([])
    expect(splitPastedLines('\n\r\n \t \n')).toEqual([])
  })

  it('keeps a single line as it is, trimmed', () => {
    expect(splitPastedLines('  Buy milk  ')).toEqual(['Buy milk'])
  })

  it('splits on every kind of line break and drops the empty lines', () => {
    expect(splitPastedLines('one\r\ntwo\n\nthree\rfour\n')).toEqual(['one', 'two', 'three', 'four'])
    expect(splitPastedLines('  a  \n \n  b ')).toEqual(['a', 'b'])
  })
})

describe('planPastedTask', () => {
  it('runs the parser on the line: date, priority, label, project and the clean title', () => {
    const plan = planPastedTask('Buy milk tomorrow @errands p2 #Work', context())!
    expect(plan.projectId).toBe(2)
    expect(plan.labelNames).toEqual(['errands'])
    expect(plan.payload.title).toBe('Buy milk')
    expect(plan.payload.priority).toBe(3)
    // A date without a time is a date-only value (local 23:59:59 of that day).
    expect(plan.payload.due_date).toBe(dateOnlyDue('2026-10-07'))
  })

  it('keeps a time of day when the line names one', () => {
    const plan = planPastedTask('Call Sam tomorrow at 3pm', context())!
    expect(plan.payload.title).toBe('Call Sam')
    expect(localDateOf(plan.payload.due_date)).toBe('2026-10-07')
    expect(new Date(plan.payload.due_date!).getHours()).toBe(15)
  })

  it('turns a recurrence into repeat_after and repeat_mode', () => {
    const plan = planPastedTask('Water plants every 2 weeks', context())!
    expect(plan.payload.title).toBe('Water plants')
    expect(plan.payload.repeat_after).toBe(2 * 7 * 24 * 60 * 60)
    expect(plan.payload.repeat_mode).toBe(0)
  })

  it('puts the task in the list the paste happened in when no project is named', () => {
    expect(planPastedTask('Plain task', context({ projectId: 2 }))!.projectId).toBe(2)
    // A project that does not exist is ignored, like in the task composer.
    expect(planPastedTask('Task #Nowhere', context({ projectId: 2 }))!.projectId).toBe(2)
  })

  it('uses the other syntax in Vikunja mode', () => {
    const config = { enabled: true, syntaxMode: 'vikunja' as const, bangToday: true, locale: 'en-US' }
    const plan = planPastedTask('Plan trip *travel +Work !3', context({ parserConfig: config }))!
    expect(plan.payload.title).toBe('Plan trip')
    expect(plan.projectId).toBe(2)
    expect(plan.labelNames).toEqual(['travel'])
    expect(plan.payload.priority).toBe(3)
  })

  it('leaves the line alone when the parser is off, except for the ! shortcut', () => {
    const config = { enabled: false, syntaxMode: 'todoist' as const, bangToday: true, locale: 'en-US' }
    const plain = planPastedTask('Buy milk tomorrow @errands p2', context({ parserConfig: config }))!
    expect(plain.payload.title).toBe('Buy milk tomorrow @errands p2')
    expect(plain.payload.due_date).toBeUndefined()
    expect(plain.payload.priority).toBeUndefined()
    expect(plain.labelNames).toEqual([])

    const bang = planPastedTask('Pay rent !', context({ parserConfig: config }))!
    expect(bang.payload.title).toBe('Pay rent')
    expect(localDateOf(bang.payload.due_date)).toBe('2026-10-06')
  })

  it('gives a line without a date the due date of the view, and lets a date in the line win', () => {
    const today = dateOnlyDue('2026-10-06')
    expect(planPastedTask('Task', context({ defaultDueDate: today }))!.payload.due_date).toBe(today)
    expect(planPastedTask('Task tomorrow', context({ defaultDueDate: today }))!.payload.due_date).toBe(dateOnlyDue('2026-10-07'))
    expect(planPastedTask('Task', context())!.payload.due_date).toBeUndefined()
  })

  it('never sends the null date', () => {
    const plan = planPastedTask('Task', context({ defaultDueDate: NULL_DATE }))!
    expect(plan.payload.due_date).toBeUndefined()
  })

  it('falls back to the whole line when nothing but a date is left', () => {
    const plan = planPastedTask('tomorrow', context())!
    expect(plan.payload.title).toBe('tomorrow')
  })

  it('has no plan for an empty line', () => {
    expect(planPastedTask('   ', context())).toBeNull()
  })

  it('lists each label once', () => {
    const plan = planPastedTask('Task @a @a @b', context())!
    expect(plan.labelNames).toEqual(['a', 'b'])
  })
})

describe('pasteConfirmMessage', () => {
  it('says how many tasks will be created', () => {
    expect(pasteConfirmMessage(5)).toBe('Create 5 tasks from the clipboard, one per line?')
    expect(pasteConfirmMessage(2)).toBe('Create 2 tasks from the clipboard, one per line?')
  })
})

describe('createPastedTasks', () => {
  const plan = (title: string, labelNames: string[] = []): PastedTaskPlan => ({
    line: title,
    projectId: 1,
    payload: { title },
    labelNames,
  })

  it('creates one task per plan, in order, one after the other', async () => {
    const order: string[] = []
    const create = vi.fn(async (p: PastedTaskPlan) => {
      order.push(`start ${p.payload.title}`)
      await Promise.resolve()
      order.push(`end ${p.payload.title}`)
      return { id: order.length }
    })
    const result = await createPastedTasks([plan('a'), plan('b'), plan('c')], {
      create,
      isQueued: () => false,
      applyLabels: async () => {},
    })
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
    expect(result).toEqual({ created: 3, failed: [], labelsFailed: 0 })
  })

  it('applies the parsed labels to a task that exists on the server', async () => {
    const applyLabels = vi.fn(async () => {})
    await createPastedTasks([plan('a', ['x', 'y']), plan('b')], {
      create: async (p) => ({ id: p.payload.title === 'a' ? 10 : 11 }),
      isQueued: () => false,
      applyLabels,
    })
    expect(applyLabels).toHaveBeenCalledTimes(1)
    expect(applyLabels).toHaveBeenCalledWith(10, ['x', 'y'])
  })

  it('leaves the labels of a queued create to the offline queue', async () => {
    const applyLabels = vi.fn(async () => {})
    const result = await createPastedTasks([plan('a', ['x'])], {
      create: async () => ({ id: -5 }),
      isQueued: () => true,
      applyLabels,
    })
    expect(applyLabels).not.toHaveBeenCalled()
    expect(result.created).toBe(1)
  })

  it('goes on after a task fails and reports it', async () => {
    const result = await createPastedTasks([plan('a'), plan('b'), plan('c')], {
      create: async (p) => {
        if (p.payload.title === 'b') throw new Error('Server said no')
        return { id: 1 }
      },
      isQueued: () => false,
      applyLabels: async () => {},
    })
    expect(result.created).toBe(2)
    expect(result.failed).toEqual([{ line: 'b', message: 'Server said no', error: expect.any(Error) }])
  })

  it('counts a task as created when only its labels failed', async () => {
    const result = await createPastedTasks([plan('a', ['x'])], {
      create: async () => ({ id: 1 }),
      isQueued: () => false,
      applyLabels: async () => { throw new Error('label failed') },
    })
    expect(result).toEqual({ created: 1, failed: [], labelsFailed: 1 })
  })

  it('does nothing for no plans', async () => {
    const create = vi.fn()
    expect(await createPastedTasks([], { create, isQueued: () => false, applyLabels: async () => {} }))
      .toEqual({ created: 0, failed: [], labelsFailed: 0 })
    expect(create).not.toHaveBeenCalled()
  })
})
