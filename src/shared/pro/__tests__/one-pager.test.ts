import { describe, expect, it } from 'vitest'
import { buildOnePager } from '../one-pager'
import { emptyLedger, type ProLedger } from '../ledger'

const rec = <V>(value: V) => ({ value, rev: { at: 1, by: 'd' } }) as never

const base = (settings: Record<string, unknown>): ProLedger => ({
  ...emptyLedger(),
  settings: rec(settings),
  initiatives: {
    1: rec({ status: 'active', rank: 1 }),
    2: rec({ status: 'active', rank: 2 }),
  },
})

const build = (ledger: ProLedger) =>
  buildOnePager({ ledger, today: '2026-11-20', projectName: (id: number) => `P${id}`, personName: () => 'Maya' } as never)

describe('buildOnePager active heading', () => {
  it('counts against the cap', () => {
    expect(build(base({ cap: 4, cap_agreed: { by: null, on: '2026-11-01' } })).text).toContain('Active (2 of 4, agreed)')
  })

  it('says no limit when the cap is off', () => {
    const page = build(base({ cap: 4, cap_off: true }))
    expect(page.text).toContain('Active (2, no limit)')
    expect(page.text).not.toContain(' of 4')
  })
})
