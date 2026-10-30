import { describe, expect, it } from 'vitest'
import { DEFAULT_PARSER_CONFIG } from '../../task-parser'
import { dateOnlyDue } from '../../due-dates'
import { cleanTranscript, voiceCardChips, voiceConfirmation, voiceTaskDraft, type VoiceTaskContext } from '../voice-task'
import { parse } from '../../task-parser'

// Wednesday 21 October 2026, 10:00 local.
const now = new Date(2026, 9, 21, 10, 0, 0)
const ctx: VoiceTaskContext = {
  parserConfig: { ...DEFAULT_PARSER_CONFIG, bangToday: true, locale: 'en-GB' },
  projects: [
    { id: 1, title: 'Inbox' },
    { id: 7, title: 'Work' },
    { id: 9, title: 'Family' },
  ],
  inboxProjectId: 1,
  now,
}
const gb24 = { locale: 'en-GB', hour12: false }

function ok(text: string, extra: Partial<VoiceTaskContext> = {}) {
  const draft = voiceTaskDraft(text, { ...ctx, ...extra })
  if (!draft.ok) throw new Error(`expected a task from "${text}": ${draft.message}`)
  return draft
}

describe('voiceTaskDraft', () => {
  it('reads a date and time like quick add and goes to the Inbox', () => {
    const draft = ok('Call mom tomorrow 3pm')
    expect(draft.title).toBe('Call mom')
    expect(draft.projectId).toBe(1)
    expect(draft.projectTitle).toBeNull()
    expect(new Date(draft.payload.due_date!)).toEqual(new Date(2026, 9, 22, 15, 0, 0))
    expect(draft.payload.reminders).toBeUndefined()
  })

  it('reads the way a recognizer writes a time ("3 PM")', () => {
    const draft = ok('Call mom tomorrow at 3 PM')
    expect(draft.title).toBe('Call mom')
    expect(new Date(draft.payload.due_date!)).toEqual(new Date(2026, 9, 22, 15, 0, 0))
  })

  it('a date without a time is date-only (local 23:59:59)', () => {
    expect(ok('Pay rent tomorrow').payload.due_date).toBe(dateOnlyDue('2026-10-22'))
  })

  it('goes to the project the text names, and only then', () => {
    const draft = ok('Quarterly report #Work')
    expect(draft.title).toBe('Quarterly report')
    expect(draft.projectId).toBe(7)
    expect(draft.projectTitle).toBe('Work')
    expect(ok('Plan trip #Nowhere').projectId).toBe(1)
  })

  it('collects labels, priority and repeating', () => {
    const draft = ok('Water plants every week @home p1')
    expect(draft.title).toBe('Water plants')
    expect(draft.labelNames).toEqual(['home'])
    expect(draft.payload.priority).toBeGreaterThan(0)
    expect(draft.payload.repeat_after).toBe(7 * 86400)
  })

  it('stores a spoken duration token as hidden description metadata', () => {
    const draft = ok('Write report ~45')

    expect(draft.title).toBe('Write report')
    expect(draft.payload.description).toBe('<!-- vicu-duration:v1:45 -->')
    expect(voiceCardChips(draft.parsed, 'Write report ~45', ctx, gb24).map((chip) => chip.type)).toContain('duration')
  })

  it('drops the full stop a recognizer adds', () => {
    expect(ok('Buy milk.').title).toBe('Buy milk')
    expect(cleanTranscript('  Buy   milk .  ')).toBe('Buy milk')
  })

  it('with the parser off keeps every word in the title', () => {
    const draft = ok('Call mom tomorrow', { parserConfig: { ...ctx.parserConfig, enabled: false } })
    expect(draft.title).toBe('Call mom tomorrow')
    expect(draft.payload.due_date).toBeUndefined()
  })

  it('adds the default reminder to a task with a due date', () => {
    const draft = ok('Call mom tomorrow 3pm', { defaultReminder: { notifications_default_reminder_offset: 900, notifications_default_reminder_relative_to: 'due_date' } })
    expect(draft.payload.reminders).toEqual([
      { reminder: new Date(2026, 9, 22, 14, 45, 0).toISOString(), relative_period: -900, relative_to: 'due_date' },
    ])
    expect(ok('Call mom', { defaultReminder: { notifications_default_reminder_offset: 900 } }).payload.reminders).toBeUndefined()
    // The list's date counts as the due date, as in the composer.
    expect(ok('Buy milk', { list: { projectId: 1, defaultDueDate: new Date(2026, 9, 21) }, defaultReminder: { notifications_default_reminder_offset: -1 } }).payload.reminders)
      .toEqual([{ reminder: dateOnlyDue('2026-10-21'), relative_period: 0, relative_to: 'due_date' }])
  })

  it('says why nothing can be added', () => {
    expect(voiceTaskDraft('   ', ctx)).toMatchObject({ ok: false, reason: 'empty' })
    expect(voiceTaskDraft('tomorrow 3pm', ctx)).toMatchObject({ ok: false, reason: 'empty' })
    expect(voiceTaskDraft('Call mom', { ...ctx, inboxProjectId: 0 })).toMatchObject({ ok: false, reason: 'no-inbox' })
  })
})

describe('voiceTaskDraft with the list on screen', () => {
  const today = new Date(2026, 9, 21, 0, 0, 0)
  const onToday = { projectId: 1, defaultDueDate: today }
  const onWork = { projectId: 7, defaultDueDate: null }

  it('uses the list default: Today gives today, a project view gives its project', () => {
    const fromToday = ok('Buy milk', { list: onToday })
    expect(fromToday.projectId).toBe(1)
    expect(fromToday.payload.due_date).toBe(dateOnlyDue('2026-10-21'))
    const fromWork = ok('Quarterly report', { list: onWork })
    expect(fromWork.projectId).toBe(7)
    expect(fromWork.projectTitle).toBe('Work')
    expect(fromWork.payload.due_date).toBeUndefined()
  })

  it('the words win over the list default', () => {
    const named = ok('Plan holiday #Family tomorrow 9am', { list: { projectId: 7, defaultDueDate: today } })
    expect(named.projectId).toBe(9)
    expect(new Date(named.payload.due_date!)).toEqual(new Date(2026, 9, 22, 9, 0, 0))
    // A project the words name that does not exist leaves the list's.
    expect(ok('Plan holiday #Nowhere', { list: onWork }).projectId).toBe(7)
  })

  it('falls back to the Inbox when the list project is gone or archived', () => {
    const draft = ok('Buy milk', { list: { projectId: 42, defaultDueDate: null } })
    expect(draft.projectId).toBe(1)
    expect(draft.projectTitle).toBeNull()
  })

  it('without a list goes to the Inbox, undated', () => {
    const draft = ok('Buy milk', { list: null })
    expect(draft.projectId).toBe(1)
    expect(draft.payload.due_date).toBeUndefined()
  })

  it('confirms the list project by name', () => {
    expect(voiceConfirmation(ok('Quarterly report', { list: onWork }), now, gb24)).toBe('Added “Quarterly report” to Work')
    expect(voiceConfirmation(ok('Buy milk', { list: onToday }), now, gb24)).toBe('Added “Buy milk”, today')
  })
})

describe('voiceCardChips', () => {
  const chipsFor = (text: string, list: VoiceTaskContext['list']) => {
    const c = { ...ctx, list }
    return voiceCardChips(text ? parse(text, c.parserConfig, now) : null, text, c, gb24).map((chip) => `${chip.type}:${chip.label}`)
  }

  it('shows the list date and project before anything is said, never the Inbox', () => {
    expect(chipsFor('', { projectId: 7, defaultDueDate: null })).toEqual(['project:Work'])
    expect(chipsFor('', { projectId: 1, defaultDueDate: new Date(2026, 9, 21) })).toEqual(['date:Wed 21 Oct'])
    expect(chipsFor('', null)).toEqual([])
  })

  it('replaces them with what the words say', () => {
    expect(chipsFor('Call mom tomorrow 3pm #Family', { projectId: 7, defaultDueDate: new Date(2026, 9, 21) })).toEqual([
      'date:Thu 22 Oct, 15:00',
      'project:Family',
    ])
  })
})

describe('voiceConfirmation', () => {
  it('says what was added with the row date phrase', () => {
    expect(voiceConfirmation(ok('Call mom tomorrow 3pm'), now, gb24)).toBe('Added “Call mom”, tomorrow, 15:00')
    expect(voiceConfirmation(ok('Pay rent today'), now, gb24)).toBe('Added “Pay rent”, today')
    expect(voiceConfirmation(ok('Quarterly report #Work'), now, gb24)).toBe('Added “Quarterly report” to Work')
    expect(voiceConfirmation(ok('Buy milk'), now, gb24)).toBe('Added “Buy milk”')
  })

  it('uses the 12-hour clock where the format says so', () => {
    expect(voiceConfirmation(ok('Call mom tomorrow 3pm'), now, { locale: 'en-US', hour12: true })).toBe('Added “Call mom”, tomorrow, 3:00 PM')
  })
})
