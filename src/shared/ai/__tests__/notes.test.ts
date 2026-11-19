import { describe, expect, it } from 'vitest'
import {
  canUpdateNotes,
  defaultOwnerAction,
  knownProjects,
  mergeNotesBatch,
  namedTitle,
  notesBatches,
  notesContextJson,
  notesPlanAsAnswer,
  notesSourceLine,
  notesUserMessage,
  notesWithSource,
  ownerOf,
  projectsInUse,
  readPageAnswer,
  readPageUserText,
  tickedBy,
  type NotesFilter,
} from '../notes'
import { aiFixture } from './fixture'

// docs/ai-assistant-v1.md section 4.9 against the `notes` vectors of test-fixtures/ai-tools-v1.json
// (the `notes.checks` vectors run with the real parser in src/renderer/lib/ai/__tests__, in three
// zones), plus rules the vectors do not pin.

const notes = aiFixture.notes

describe('notes vectors', () => {
  for (const vector of notes.batches) {
    it(`batches: ${vector.name}`, () => expect(notesBatches(vector.pages, vector.max)).toEqual(vector.expect))
  }

  for (const vector of notes.merge) {
    it(`merge: ${vector.name}`, () => expect(mergeNotesBatch(vector.plan, vector.batch)).toEqual(vector.expect))
  }

  for (const vector of notes.requests) {
    it(`request: ${vector.name}`, () => {
      const contextJson = notesContextJson(vector.context)
      expect(contextJson).toBe(vector.expect.contextJson)
      expect(Object.keys(JSON.parse(contextJson))).toEqual(notes.contextKeys)
      const plan = vector.plan ? notesPlanAsAnswer(vector.plan.projects, vector.plan.drafts, () => null) : undefined
      expect(notesUserMessage(contextJson, vector.pages, { soFar: vector.soFar, plan, words: vector.words })).toBe(vector.expect.user)
    })
  }

  it('owners', () => {
    for (const vector of notes.owners) expect([vector.value, ownerOf(vector.value, vector.me)]).toEqual([vector.value, vector.expect])
  })

  it('owner actions and what each filter ticks', () => {
    for (const vector of notes.actions.cases) {
      const action = defaultOwnerAction(vector.owner, { ...notes.actions.world, agreed: vector.agreed })
      expect([vector.owner, vector.agreed, action]).toEqual([vector.owner, vector.agreed, vector.expect])
      for (const filter of ['mine', 'mine_and_waiting', 'everything'] as NotesFilter[]) {
        expect([vector.owner, filter, tickedBy(filter, action)]).toEqual([vector.owner, filter, vector.ticked[filter]])
      }
    }
  })

  it('reading a page', () => {
    for (const vector of notes.read.answers) expect(readPageAnswer(vector.answer)).toBe(vector.expect)
    for (const vector of notes.read.userText) expect(readPageUserText(vector.page, vector.pages, vector.title)).toBe(vector.expect)
  })

  it('source lines and named titles', () => {
    for (const vector of notes.sourceLines) {
      const line = notesSourceLine(vector.title, vector.date, vector.page, vector.from)
      expect(line).toBe(vector.expect.line)
      expect(notesWithSource(vector.notes, line)).toBe(vector.expect.notes)
    }
    for (const vector of notes.namedTitles) expect(namedTitle(vector.name, vector.title)).toBe(vector.expect)
  })
})

describe('notes rules', () => {
  it('lists the plan\'s new projects with their paths for the next batch', () => {
    const plan = { projects: [
      { ref: 'p1', title: 'Offsite Q4', parent_id: 12, parent_ref: null },
      { ref: 'p2', title: 'Hiring', parent_id: null, parent_ref: 'p1' },
      { ref: 'p3', title: 'Travel', parent_id: null, parent_ref: null },
    ] }
    expect(knownProjects(plan, (id) => (id === 12 ? 'Home' : ''))).toEqual([
      { ref: 'p1', title: 'Offsite Q4', path: 'Home / Offsite Q4' },
      { ref: 'p2', title: 'Hiring', path: 'Home / Offsite Q4 / Hiring' },
      { ref: 'p3', title: 'Travel', path: 'Travel' },
    ])
  })

  it('offers Update only for a plan of one batch within the brain dump limit', () => {
    expect(canUpdateNotes(1, 60)).toBe(true)
    expect(canUpdateNotes(1, 61)).toBe(false)
    expect(canUpdateNotes(2, 3)).toBe(false)
  })

  it('never leaves a page empty-handed: a page longer than the limit is cut into parts with its number', () => {
    const text = Array.from({ length: 50 }, (_, i) => `Line ${i}`).join('\n')
    const batches = notesBatches([{ n: 7, text }], 60)
    expect(batches.flat().every((part) => part.n === 7 && part.text.length <= 60)).toBe(true)
    expect(batches.flat().map((part) => part.text).join('\n')).toBe(text)
  })

  it('creates only the new projects that hold a ticked task, with their parents', () => {
    const projects = [
      { ref: 'p1', title: 'Offsite', parent_id: null, parent_ref: null },
      { ref: 'p2', title: 'Hiring', parent_id: null, parent_ref: 'p1' },
      { ref: 'p3', title: 'Travel', parent_id: null, parent_ref: null },
    ]
    expect(projectsInUse(projects, [{ project_ref: 'p2' }, { project_ref: null }]).map((p) => p.ref)).toEqual(['p1', 'p2'])
    expect(projectsInUse(projects, [])).toEqual([])
  })
})
