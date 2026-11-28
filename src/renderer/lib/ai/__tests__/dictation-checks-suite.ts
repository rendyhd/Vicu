import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { checkBrainDumpAnswer, type BrainDumpAnswer } from '../../../../shared/ai/brain-dump'
import { checkDictationAnswer, type CheckContext, type DictationAnswer } from '../../../../shared/ai/dictation'
import { checkNotesAnswer, type NotesAnswer, type NotesCheckInput } from '../../../../shared/ai/notes'
import { checkOrganizeAnswer, type OrganizeAnswer, type OrganizeSession } from '../../../../shared/ai/organize'
import { readSaid } from '../said-parser'

// docs/ai-assistant-v1.md section 4.3 against `dictation.checks` of test-fixtures/ai-tools-v1.json,
// and section 4.8.3 against `brainDump.checks` (the same context; the list's default due date is
// given but a brain dump does not use it), with the desktop's real quick-add parser reading
// `when.said`. The vectors' `said` dates were
// worked out by hand from semantics 5.1; a vector the parser reads differently is listed in
// PARSER_DISAGREEMENTS with the reason, and reported as a todo instead of failing.

const fixture = JSON.parse(readFileSync(join(__dirname, '../../../../../test-fixtures/ai-tools-v1.json'), 'utf8'))
// The vectors are local wall-clock times: the suite runs in the process zone and in two far ones.

interface CheckVector {
  name: string
  reference: string
  locale: string
  defaultDue: string | null
  context?: Omit<CheckContext, 'reference' | 'defaultDue' | 'readSaid'>
  answer: DictationAnswer
  expect: unknown
}

/**
 * Drafts whose `said` the desktop parser reads differently from the hand-worked vector, by vector
 * name and ref, with the reason. The rest of such a vector is still checked; these drafts are todos.
 */
const PARSER_DISAGREEMENTS: Record<string, Record<string, string>> = {}

interface BrainDumpVector extends Omit<CheckVector, 'answer'> {
  answer: BrainDumpAnswer
}

interface OrganizeVector {
  name: string
  session: OrganizeSession
  reference: string
  locale: string
  tasks: Array<{ id: number; title: string; project_id: number; due: string | null }>
  answer: OrganizeAnswer
  expect: unknown
}

function contextFor(vector: Omit<CheckVector, 'answer'>): CheckContext {
  const context = vector.context ?? fixture.dictation.context
  return {
    reference: vector.reference,
    defaultDue: vector.defaultDue ?? null,
    projects: context.projects,
    default_project_id: context.default_project_id,
    labels: context.labels,
    places: context.places,
    readSaid: (said) => readSaid(said, vector.reference, vector.locale),
  }
}

export function runDictationChecksSuite(zone: string): void {
describe(`dictation checks (fixture vectors, real parser, ${zone})`, () => {
  for (const vector of fixture.dictation.checks as CheckVector[]) {
    const known = PARSER_DISAGREEMENTS[vector.name] ?? {}
    for (const [ref, reason] of Object.entries(known)) it.todo(`${vector.name} ${ref}: ${reason}`)
    it(vector.name, () => {
      const result = checkDictationAnswer(vector.answer, contextFor(vector))
      const expected = vector.expect as typeof result
      const keep = <T extends { ref: string }>(list: T[]) => list.filter((entry) => !(entry.ref in known))
      expect({ ...result, drafts: keep(result.drafts), dropped: keep(result.dropped) })
        .toEqual({ ...expected, drafts: keep(expected.drafts), dropped: keep(expected.dropped) })
    })
  }

  for (const vector of fixture.brainDump.checks as BrainDumpVector[]) {
    it(`brain dump: ${vector.name}`, () => {
      expect(checkBrainDumpAnswer(vector.answer, contextFor(vector))).toEqual(vector.expect)
    })
  }

  // Notes (4.9.6): the brain dump checks with the projects of earlier batches, then page, from, owner.
  for (const vector of fixture.notes.checks as Array<BrainDumpVector & NotesCheckInput & { answer: NotesAnswer }>) {
    it(`notes: ${vector.name}`, () => {
      const result = checkNotesAnswer(vector.answer, contextFor({ ...vector, defaultDue: null }), {
        pages: vector.pages,
        me: vector.me,
        known: vector.known,
        firstProjectNumber: vector.firstProjectNumber,
        firstDraftNumber: vector.firstDraftNumber,
      })
      expect(result).toEqual(vector.expect)
      for (const draft of result.drafts) expect(Object.keys(draft).slice(-4)).toEqual(['guessed', 'owner', 'page', 'from'])
    })
  }

  // Suggestions in guided sessions (section 9.3), with the dictation context.
  for (const vector of fixture.organize.checks as OrganizeVector[]) {
    it(`organize: ${vector.name}`, () => {
      const tasks = vector.tasks.map((task) => ({ id: task.id, title: task.title, project_id: task.project_id, has_due: task.due !== null }))
      const result = checkOrganizeAnswer(vector.answer, vector.session, tasks, contextFor({ ...vector, defaultDue: null }))
      expect(result).toEqual(vector.expect)
    })
  }

  it('brain dump drafts have the dictation shape with project_ref after project_id', () => {
    for (const vector of fixture.brainDump.checks as BrainDumpVector[]) {
      const result = checkBrainDumpAnswer(vector.answer, contextFor(vector))
      expect(Object.keys(result)).toEqual(['projects', 'drafts', 'dropped', 'unclear'])
      for (const draft of result.drafts) {
        expect(Object.keys(draft)).toEqual(['ref', 'title', 'notes', 'due', 'project_id', 'project_ref', 'labels', 'priority', 'repeat', 'reminder', 'place', 'subtasks', 'guessed'])
      }
      for (const project of result.projects) expect(Object.keys(project)).toEqual(['ref', 'title', 'parent_id', 'parent_ref'])
    }
  })

  it('reads every said phrase of the vectors with the parser as the vectors expect', () => {
    // A per-phrase view of the same vectors, so a disagreement names the words.
    const problems: string[] = []
    for (const vector of fixture.dictation.checks as CheckVector[]) {
      const drafts = (vector.expect as { drafts: Array<{ ref: string; due: string | null; guessed: string[] }> }).drafts
      vector.answer.tasks.forEach((task, i) => {
        const said = task.when?.said
        if (!said || task.ref in (PARSER_DISAGREEMENTS[vector.name] ?? {})) return
        const draft = drafts.find((d) => d.ref === task.ref) ?? drafts[i]
        const read = readSaid(said, vector.reference, vector.locale)
        const expectedFromParser = draft && !draft.guessed.includes('when') && draft.due !== null && vector.defaultDue === null
        if (expectedFromParser) {
          const got = read ? `${read.date}T${read.time ? `${read.time}:00` : '23:59:59'}` : null
          if (got !== draft.due) problems.push(`${vector.name} ${task.ref} "${said}": parser ${got}, vector ${draft.due}`)
        }
      })
    }
    expect(problems).toEqual([])
  })
})
}
