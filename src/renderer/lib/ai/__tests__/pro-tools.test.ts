import { describe, expect, it } from 'vitest'
import type { ToolContext } from '../ask-tools'
import { PRO_TOOL_NAMES, runProTool } from '../pro-tools'
import { task, workspace } from './helpers'
import { emptyLedger, type ProLedger } from '../../../../shared/pro/ledger'
import { PRO_AI, askTool } from '../../../../shared/ai/contract'

// docs/ai-assistant-v1.md section 11.3.
const now = new Date(2026, 10, 12, 10, 0, 0)
const due = (d: number) => new Date(2026, 10, d, 23, 59, 59).toISOString()
const rec = <V>(value: V) => ({ value, rev: { at: 1, by: 'd' } }) as never

const tasks = [
  task(1, 'Send the deck', { project_id: 20, due_date: due(10) }),
  task(2, 'Review the budget', { project_id: 12, due_date: due(20) }),
  task(3, 'Plain task', { project_id: 12 }),
]
const ledger: ProLedger = {
  ...emptyLedger(),
  promises: {
    1: rec({ dir: 'theirs', person: 7, words: 'I will send it', verdicts: [] }),
    2: rec({ dir: 'mine', person: 7, verdicts: [] }),
  },
  initiatives: { 20: rec({ status: 'active', rank: 1, owner: 7 }), 5: rec({ status: 'parked', parked: { on: '2026-11-01', reason: 'Budget' } }) },
  owed: { o: rec({ what: 'Approve the venue', from: 7, initiative: 20, opened: '2026-11-02' }) },
}
const base: ToolContext = {
  ws: workspace(),
  now: () => now,
  fetchTasks: async () => tasks,
  fetchTask: async (id) => tasks.find((t) => t.id === id) ?? null,
  syncedValues: {},
  review: { enabled: false, defaultCadenceDays: 14, excludeInbox: false },
}
const ctx: ToolContext = { ...base, pro: { ledger, people: [{ id: 7, title: 'Maya Lee', aliases: ['MJ'] }] } }

describe('Pro read tools', () => {
  it('are the contract tools and found by askTool', () => {
    expect([...PRO_TOOL_NAMES]).toEqual(PRO_AI.askTools.map((tool) => tool.name))
    expect(askTool('get_portfolio')?.kind).toBe('read')
  })

  it('refuse without Pro data (the switch is off)', async () => {
    await expect(runProTool('get_portfolio', {}, base)).rejects.toMatchObject({ code: 'invalid_arguments' })
  })

  it('get_promises filters by person, direction and verdict due', async () => {
    const all = await runProTool('get_promises', { person: null, direction: 'any', verdict_due: false }, ctx) as { promises: Array<{ task: { id: number }; person: string; misses: number }> }
    expect(all.promises.map((entry) => entry.task.id)).toEqual([1, 2])
    expect(all.promises[0].person).toBe('Maya Lee')
    const theirsDue = await runProTool('get_promises', { person: 'MJ', direction: 'theirs', verdict_due: true }, ctx) as { promises: unknown[] }
    expect(theirsDue.promises).toHaveLength(1)
    await expect(runProTool('get_promises', { person: 'Nobody', direction: 'any', verdict_due: false }, ctx)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('get_person gives both directions, the pattern and the agenda', async () => {
    const person = await runProTool('get_person', { name: 'maya' }, ctx) as { name: string; promised_to_you: unknown[]; you_promised: unknown[]; pattern: string; agenda: string[] }
    expect(person.name).toBe('Maya Lee')
    expect(person.promised_to_you).toHaveLength(1)
    expect(person.you_promised).toHaveLength(1)
    expect(person.agenda).toContain('Decision needed: Approve the venue')
    expect(typeof person.pattern).toBe('string')
  })

  it('get_portfolio and get_initiative read the ledger', async () => {
    const portfolio = await runProTool('get_portfolio', {}, ctx) as { initiatives: Array<{ name: string; owner: string }>; parked: Array<{ name: string; reason: string }>; decisions_owed: unknown[] }
    expect(portfolio.initiatives).toEqual([expect.objectContaining({ name: 'Travel / Lisbon trip', owner: 'Maya Lee', rank: 1 })])
    expect(portfolio.parked).toEqual([expect.objectContaining({ name: 'Travel', reason: 'Budget' })])
    const initiative = await runProTool('get_initiative', { name: 'lisbon trip' }, ctx) as { decisions_owed: unknown[]; promises: unknown[] }
    expect(initiative.decisions_owed).toHaveLength(1)
    expect(initiative.promises).toHaveLength(1)
  })
})
