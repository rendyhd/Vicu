import { describe, expect, it } from 'vitest'
import { buildImpact, quarterOf } from '../impact'
import { emptyLedger, type ProLedger } from '../ledger'

const rec = <V>(value: V) => ({ value, rev: { at: 1, by: 'd' } }) as never

describe('quarterOf', () => {
  it('finds the quarter and earlier ones across a year', () => {
    expect(quarterOf('2026-11-12')).toEqual({ name: 'Q4 2026', from: '2026-10-01', to: '2026-12-31' })
    expect(quarterOf('2026-02-03', 1)).toEqual({ name: 'Q4 2025', from: '2025-10-01', to: '2025-12-31' })
    expect(quarterOf('2026-05-31').to).toBe('2026-06-30')
  })
})

describe('buildImpact', () => {
  it('lists value, closed initiatives, decisions, promises and growth inside the quarter', () => {
    const ledger: ProLedger = {
      ...emptyLedger(),
      log: {
        a: rec({ kind: 'value', text: 'Shipped billing', initiative: 7, at: '2026-10-20' }),
        b: rec({ kind: 'decision', text: 'Drop the old API', initiative: null, at: '2026-11-02' }),
        c: rec({ kind: 'value', text: 'Too early', initiative: 7, at: '2026-09-30' }),
      },
      initiatives: { 7: rec({ status: 'closed', closed_on: '2026-11-01' }) },
      promises: {
        1: rec({ dir: 'mine', person: 3, verdicts: [{ id: 'v', at: '2026-10-10T10:00:00Z', kind: 'delivered' }] }),
        2: rec({ dir: 'theirs', person: 3, verdicts: [{ id: 'w', at: '2026-10-11T10:00:00Z', kind: 'taken_over' }] }),
      },
    }
    const impact = buildImpact({ ledger, quarter: quarterOf('2026-11-12'), projectName: (id) => `P${id}`, personName: () => 'Maya', growth: 'Learnt to say no' })
    expect(impact.sections.map((section) => section.heading)).toEqual(['Value delivered', 'Initiatives closed', 'Decisions', 'Promises', 'Growth'])
    expect(impact.sections[0].lines).toEqual(['Shipped billing (P7)'])
    expect(impact.text).toContain('You kept 1 promise (0 late), dropped 0.')
    expect(impact.text).toContain('1 you took over')
    expect(impact.html).toContain('<h1>Impact, Q4 2026</h1>')
  })

  it('says so when nothing was recorded', () => {
    expect(buildImpact({ ledger: emptyLedger(), quarter: quarterOf('2026-11-12'), projectName: String, personName: String }).text).toContain('Nothing recorded')
  })
})
