import { describe, expect, it } from 'vitest'
import { emptyLedger, type ProLedger } from '../../../../shared/pro/ledger'
import { checkedOperations, dismissedUntilTomorrow, uncheckedOperations } from '../follow-up-actions'

const ledgerWith = (promises: Record<string, unknown>): ProLedger => {
  const ledger = emptyLedger()
  for (const [id, value] of Object.entries(promises)) (ledger.promises as Record<string, unknown>)[id] = { value, revision: 1 }
  return ledger
}

describe('checkedOperations', () => {
  it('marks every promise of the line in one set of operations and skips tasks without one', () => {
    const ledger = ledgerWith({ '1': { dir: 'theirs', person: 9 }, '2': { dir: 'theirs', person: 9, checked: ['2026-11-01T10:00:00.000Z'] } })
    const at = '2026-11-20T09:00:00.000Z'
    const ops = checkedOperations(ledger, [1, 2, 3], at)
    expect(ops).toHaveLength(2)
    expect(ops[0]).toMatchObject({ op: 'set', collection: 'promises', id: '1', value: { checked: [at] } })
    expect(ops[1]).toMatchObject({ id: '2', value: { checked: ['2026-11-01T10:00:00.000Z', at] } })
  })

  it('undoes exactly that mark, keeping earlier ones and other fields', () => {
    const at = '2026-11-20T09:00:00.000Z'
    const ledger = ledgerWith({ '1': { dir: 'theirs', person: 9, checked: [at] }, '2': { dir: 'theirs', person: 9, words: 'x', checked: ['2026-11-01T10:00:00.000Z', at] } })
    const ops = uncheckedOperations(ledger, [1, 2], at)
    expect(ops[0]).toMatchObject({ id: '1', value: { dir: 'theirs', person: 9 } })
    expect((ops[0] as { value: Record<string, unknown> }).value.checked).toBeUndefined()
    expect(ops[1]).toMatchObject({ id: '2', value: { words: 'x', checked: ['2026-11-01T10:00:00.000Z'] } })
  })
})

describe('dismissedUntilTomorrow', () => {
  it('hides the line until tomorrow and drops old entries', () => {
    const next = dismissedUntilTomorrow({ 'check:1': '2026-11-19', 'bring:2': '2026-11-25' }, 'note:2026-11-16', '2026-11-20')
    expect(next).toEqual({ 'bring:2': '2026-11-25', 'note:2026-11-16': '2026-11-21' })
  })
  it('works from nothing', () => {
    expect(dismissedUntilTomorrow(undefined, 'a', '2026-12-31')).toEqual({ a: '2027-01-01' })
  })
})
