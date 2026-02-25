import { describe, it, expect } from 'vitest'
import { parse, extractBangToday } from '../index'
import { recurrenceToVikunja } from '../recurrence-map'
import type { ParserConfig } from '../types'

const todoist: ParserConfig = { enabled: true, syntaxMode: 'todoist' }
const vikunja: ParserConfig = { enabled: true, syntaxMode: 'vikunja' }
const disabled: ParserConfig = { enabled: false, syntaxMode: 'todoist' }

// ─── Labels ─────────────────────────────────────────────────

describe('labels', () => {
  it('extracts single label in Todoist mode', () => {
    const r = parse('buy groceries @shopping', todoist)
    expect(r.labels).toEqual(['shopping'])
    expect(r.title).toBe('buy groceries')
  })

  it('extracts multiple labels in Todoist mode', () => {
    const r = parse('task @work @urgent', todoist)
    expect(r.labels).toEqual(['work', 'urgent'])
    expect(r.title).toBe('task')
  })

  it('extracts labels with Vikunja prefix *', () => {
    const r = parse('task *work *urgent', vikunja)
    expect(r.labels).toEqual(['work', 'urgent'])
    expect(r.title).toBe('task')
  })

  it('ignores @ in Vikunja mode', () => {
    const r = parse('email @john', vikunja)
    expect(r.labels).toEqual([])
    expect(r.title).toBe('email @john')
  })

  it('handles quoted labels', () => {
    const r = parse('task @"multi word"', todoist)
    expect(r.labels).toEqual(['multi word'])
    expect(r.title).toBe('task')
  })

  it('ignores dangling @', () => {
    const r = parse('dangling @', todoist)
    expect(r.labels).toEqual([])
    expect(r.title).toBe('dangling @')
  })

  it('handles label with hyphens', () => {
    const r = parse('task @follow-up', todoist)
    expect(r.labels).toEqual(['follow-up'])
    expect(r.title).toBe('task')
  })
})

// ─── Projects ───────────────────────────────────────────────

describe('projects', () => {
  it('extracts project in Todoist mode', () => {
    const r = parse('buy groceries #shopping', todoist)
    expect(r.project).toBe('shopping')
    expect(r.title).toBe('buy groceries')
  })

  it('ignores # followed by number (issue reference)', () => {
    const r = parse('review PR #142', todoist)
    expect(r.project).toBeNull()
    expect(r.title).toBe('review PR #142')
  })

  it('extracts project with Vikunja prefix +', () => {
    const r = parse('task +work', vikunja)
    expect(r.project).toBe('work')
    expect(r.title).toBe('task')
  })

  it('handles quoted project', () => {
    const r = parse('task #"my project"', todoist)
    expect(r.project).toBe('my project')
    expect(r.title).toBe('task')
  })

  it('takes only first project', () => {
    const r = parse('task #work #personal', todoist)
    expect(r.project).toBe('work')
    // Second # stays in title
    expect(r.title).toBe('task #personal')
  })
})

// ─── Priority ───────────────────────────────────────────────

describe('priority', () => {
  it('extracts Todoist p1 as Vikunja 4 (urgent)', () => {
    const r = parse('urgent task p1', todoist)
    expect(r.priority).toBe(4)
    expect(r.title).toBe('urgent task')
  })

  it('extracts Todoist p3 as Vikunja 2 (medium)', () => {
    const r = parse('task p3', todoist)
    expect(r.priority).toBe(2)
    expect(r.title).toBe('task')
  })

  it('does not match p2p (word boundary)', () => {
    const r = parse('p3 talk about p2p', todoist)
    expect(r.priority).toBe(2)
    expect(r.title).toBe('talk about p2p')
  })

  it('extracts Vikunja !3 as priority 3', () => {
    const r = parse('task !3', vikunja)
    expect(r.priority).toBe(3)
    expect(r.title).toBe('task')
  })

  it('does not treat !4 as priority in Todoist mode', () => {
    const r = parse('task !4', todoist)
    expect(r.priority).toBeNull()
    // !4 stays in title (it's not a Todoist pattern, nor a word priority)
    expect(r.title).toBe('task !4')
  })

  it('extracts !urgent word priority in both modes', () => {
    const r = parse('task !urgent', todoist)
    expect(r.priority).toBe(4)
    expect(r.title).toBe('task')
  })

  it('extracts !low word priority', () => {
    const r = parse('task !low', vikunja)
    expect(r.priority).toBe(1)
    expect(r.title).toBe('task')
  })
})

// ─── Recurrence ─────────────────────────────────────────────

describe('recurrence', () => {
  it('extracts "every 2 weeks"', () => {
    const r = parse('standup every 2 weeks', todoist)
    expect(r.recurrence).toEqual({ interval: 2, unit: 'week' })
    expect(r.title).toBe('standup')
  })

  it('extracts "every day"', () => {
    const r = parse('journal every day', todoist)
    expect(r.recurrence).toEqual({ interval: 1, unit: 'day' })
    expect(r.title).toBe('journal')
  })

  it('does NOT extract "weekly" from "weekly standup"', () => {
    const r = parse('weekly standup', todoist)
    expect(r.recurrence).toBeNull()
    expect(r.title).toBe('weekly standup')
  })

  it('extracts standalone "daily" when it is the only text', () => {
    const r = parse('daily', todoist)
    expect(r.recurrence).toEqual({ interval: 1, unit: 'day' })
    expect(r.title).toBe('')
  })

  it('extracts "monthly" as standalone with other tokens consumed', () => {
    const r = parse('monthly @work', todoist)
    expect(r.recurrence).toEqual({ interval: 1, unit: 'month' })
    expect(r.labels).toEqual(['work'])
    expect(r.title).toBe('')
  })
})

// ─── Dates ──────────────────────────────────────────────────

describe('dates', () => {
  it('extracts "tomorrow" as a date', () => {
    const r = parse('buy groceries tomorrow', todoist)
    expect(r.dueDate).toBeInstanceOf(Date)
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(r.dueDate!.getDate()).toBe(tomorrow.getDate())
    expect(r.title).toBe('buy groceries')
  })

  it('extracts "tomorrow 3pm"', () => {
    const r = parse('buy groceries tomorrow 3pm', todoist)
    expect(r.dueDate).toBeInstanceOf(Date)
    expect(r.dueDate!.getHours()).toBe(15)
    expect(r.title).toBe('buy groceries')
  })

  it('does not extract date from consumed regions', () => {
    // "monday" in a label shouldn't be parsed as a date
    const r = parse('task @monday', todoist)
    expect(r.labels).toEqual(['monday'])
    // The date extractor sees spaces where @monday was, so no date
    expect(r.dueDate).toBeNull()
    expect(r.title).toBe('task')
  })
})

// ─── Bang Today (!→ today) ──────────────────────────────────

describe('extractBangToday', () => {
  it('converts trailing ! to today', () => {
    const r = extractBangToday('call dentist !')
    expect(r.dueDate).toBeInstanceOf(Date)
    expect(r.dueDate!.getHours()).toBe(0)
    expect(r.title).toBe('call dentist')
  })

  it('converts trailing ! without space to today', () => {
    const r = extractBangToday('call dentist!')
    expect(r.dueDate).toBeInstanceOf(Date)
    expect(r.title).toBe('call dentist')
  })

  it('returns null for no trailing !', () => {
    const r = extractBangToday('call dentist')
    expect(r.dueDate).toBeNull()
    expect(r.title).toBe('call dentist')
  })

  it('does not treat !word as bang-today', () => {
    const r = extractBangToday('task !urgent')
    expect(r.dueDate).toBeNull()
    expect(r.title).toBe('task !urgent')
  })
})

// ─── Disabled Parser ────────────────────────────────────────

describe('disabled parser', () => {
  it('returns raw input as title when disabled', () => {
    const r = parse('buy groceries tomorrow @shopping p1', disabled)
    expect(r.title).toBe('buy groceries tomorrow @shopping p1')
    expect(r.dueDate).toBeNull()
    expect(r.priority).toBeNull()
    expect(r.labels).toEqual([])
    expect(r.project).toBeNull()
    expect(r.recurrence).toBeNull()
    expect(r.tokens).toEqual([])
  })
})

// ─── Suppress Types ─────────────────────────────────────────

describe('suppressTypes', () => {
  it('suppresses date extraction when specified', () => {
    const cfg: ParserConfig = { enabled: true, syntaxMode: 'todoist', suppressTypes: ['date'] }
    const r = parse('task tomorrow @work p1', cfg)
    expect(r.dueDate).toBeNull()
    expect(r.labels).toEqual(['work'])
    expect(r.priority).toBe(4)
    expect(r.title).toBe('task tomorrow')
  })

  it('suppresses labels when specified', () => {
    const cfg: ParserConfig = { enabled: true, syntaxMode: 'todoist', suppressTypes: ['label'] }
    const r = parse('task @work p1', cfg)
    expect(r.labels).toEqual([])
    expect(r.priority).toBe(4)
    expect(r.title).toBe('task @work')
  })
})

// ─── Combined Parsing ───────────────────────────────────────

describe('combined parsing', () => {
  it('parses full Todoist-style input', () => {
    const r = parse('buy groceries tomorrow 3pm #shopping @errands p3', todoist)
    expect(r.project).toBe('shopping')
    expect(r.labels).toEqual(['errands'])
    expect(r.priority).toBe(2) // p3 → Vikunja 2
    expect(r.dueDate).toBeInstanceOf(Date)
    expect(r.title).toBe('buy groceries')
  })

  it('parses full Vikunja-style input', () => {
    const r = parse('buy groceries tomorrow +shopping *errands !3', vikunja)
    expect(r.project).toBe('shopping')
    expect(r.labels).toEqual(['errands'])
    expect(r.priority).toBe(3)
    expect(r.dueDate).toBeInstanceOf(Date)
    expect(r.title).toBe('buy groceries')
  })

  it('handles empty input', () => {
    const r = parse('', todoist)
    expect(r.title).toBe('')
    expect(r.tokens).toEqual([])
  })

  it('handles whitespace-only input', () => {
    const r = parse('   ', todoist)
    expect(r.title).toBe('   ')
    expect(r.tokens).toEqual([])
  })
})

// ─── Edge Cases from Spec ───────────────────────────────────

describe('edge cases', () => {
  it('task !4 in Vikunja = priority 4, NOT today shortcut', () => {
    const r = parse('task !4', vikunja)
    expect(r.priority).toBe(4)
    expect(r.title).toBe('task')
  })

  it('task !4 in Todoist = !4 stays in title', () => {
    const r = parse('task !4', todoist)
    expect(r.priority).toBeNull()
    expect(r.title).toBe('task !4')
  })

  it('review PR #142 = no project, #142 stays in title', () => {
    const r = parse('review PR #142', todoist)
    expect(r.project).toBeNull()
    expect(r.title).toBe('review PR #142')
  })

  it('p3 talk about p2p = priority 3, p2p in title', () => {
    const r = parse('p3 talk about p2p', todoist)
    expect(r.priority).toBe(2) // p3 → Vikunja 2
    expect(r.title).toBe('talk about p2p')
  })

  it('weekly standup = no recurrence', () => {
    const r = parse('weekly standup', todoist)
    expect(r.recurrence).toBeNull()
    expect(r.title).toBe('weekly standup')
  })

  it('email @john in Vikunja = no labels, @john in title', () => {
    const r = parse('email @john', vikunja)
    expect(r.labels).toEqual([])
    expect(r.title).toBe('email @john')
  })

  it('dangling @ in Todoist = no labels, @ in title', () => {
    const r = parse('dangling @', todoist)
    expect(r.labels).toEqual([])
    expect(r.title).toBe('dangling @')
  })
})

// ─── Recurrence Map ─────────────────────────────────────────

describe('recurrenceToVikunja', () => {
  it('daily → 86400s, mode 0', () => {
    expect(recurrenceToVikunja({ interval: 1, unit: 'day' })).toEqual({
      repeat_after: 86400,
      repeat_mode: 0,
    })
  })

  it('weekly → 604800s, mode 0', () => {
    expect(recurrenceToVikunja({ interval: 1, unit: 'week' })).toEqual({
      repeat_after: 604800,
      repeat_mode: 0,
    })
  })

  it('monthly → 0, mode 1', () => {
    expect(recurrenceToVikunja({ interval: 1, unit: 'month' })).toEqual({
      repeat_after: 0,
      repeat_mode: 1,
    })
  })

  it('yearly → 365 * 86400, mode 0', () => {
    expect(recurrenceToVikunja({ interval: 1, unit: 'year' })).toEqual({
      repeat_after: 365 * 86400,
      repeat_mode: 0,
    })
  })

  it('every 2 weeks → 2 * 604800, mode 0', () => {
    expect(recurrenceToVikunja({ interval: 2, unit: 'week' })).toEqual({
      repeat_after: 2 * 604800,
      repeat_mode: 0,
    })
  })
})
