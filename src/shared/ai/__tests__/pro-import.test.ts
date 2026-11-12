import { describe, expect, it } from 'vitest'
import { checkPromiseDrafts, proImportDocument, proImportUser, promiseDraftsUser } from '../pro-import'
import { readImport } from '../../pro/import'

describe('proImportUser', () => {
  it('holds the five parts with t- ids', () => {
    const user = proImportUser({ me: 'Rendy', people: ['Maya Lee'], initiatives: [], open: [{ taskId: 12, title: 'Send deck', person: 'Maya Lee', dir: 'theirs' }], text: 'notes' })
    expect(user).toContain('<me>\nRendy\n</me>')
    expect(user).toContain('<initiatives>\n(none)\n</initiatives>')
    expect(user).toContain('t-12: Send deck (Maya Lee, they owe it)')
    expect(user.endsWith('<text>\nnotes\n</text>')).toBe(true)
  })
})

describe('proImportDocument', () => {
  it('drops null fields and reads back as an import', () => {
    const answer = { items: [{ type: 'promise', owner: 'Maya', what: 'Send the deck', due: 'Friday', initiative: null, in_their_words: null, done_when: null, for: null, id: null, status: null, new_due: null, blocker: null, ask: null, by: null, from: null, where: null }] }
    const document = proImportDocument(answer, { kind: 'mail', title: 'Thread', date: '2026-11-12' })!
    expect(JSON.parse(document).items[0]).toEqual({ type: 'promise', owner: 'Maya', what: 'Send the deck', due: 'Friday' })
    const read = readImport(document, '2026-11-12')
    expect(read.ok).toBe(true)
    expect(read.problems).toEqual([])
    expect(read.source.kind).toBe('mail')
  })

  it('is null without items', () => {
    expect(proImportDocument({ items: [] }, { kind: 'meeting', title: '', date: null })).toBeNull()
    expect(proImportDocument('nonsense', { kind: 'meeting', title: '', date: null })).toBeNull()
  })
})

describe('checkPromiseDrafts', () => {
  const request = { person: 'Maya', me: 'Rendy', mine: ['Review the budget'], transcript: 'Maya said: yes, I will send the deck by Friday.' }

  it('keeps words that were said, reads dates and checks needs', () => {
    const drafts = checkPromiseDrafts({
      promises: [
        { what: 'Send the deck', mine: false, due_said: 'Friday', words: 'I will send the deck', done_when: null, needs: ['review the budget', 'Something else'] },
        { what: 'Invented', mine: false, due_said: null, words: 'never said this', done_when: null, needs: [] },
        { what: '  ', mine: true, due_said: null, words: null, done_when: null, needs: [] },
      ],
    }, request, (said) => (said === 'Friday' ? '2026-11-13' : null))
    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toMatchObject({ due: '2026-11-13', words: 'I will send the deck', needs: ['Review the budget'] })
    expect(drafts[1].words).toBeNull()
  })

  it('builds the user message', () => {
    expect(promiseDraftsUser(request)).toContain('<mine>\nReview the budget\n</mine>')
  })
})
