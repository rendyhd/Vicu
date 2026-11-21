import { describe, expect, it } from 'vitest'
import { emptyLedger } from '../../../../shared/pro/ledger'
import type { PromiseWorld } from '@/hooks/use-promise-world'
import type { Task } from '@/lib/vikunja-types'
import { personAgenda } from '../agenda'

const world = { ledger: emptyLedger(), promiseFor: () => null } as unknown as PromiseWorld
const topic = (id: number, title: string) => ({ id, title }) as Task

describe('personAgenda topics', () => {
  it('lists the topics after the promises, in order, and leaves out private ones', () => {
    const agenda = personAgenda('Priya', [], [], world, '2026-11-21', {
      tasks: [topic(1, 'Career plan'), topic(2, 'Salary'), topic(3, 'Team lunch')],
      hidden: [2],
    })
    expect(agenda.text).toBe(['1:1 with Priya', '', "- What's still unclear?", '', 'Topics', '- Career plan', '- Team lunch'].join('\n'))
    expect(agenda.html).toContain('<p><strong>Topics</strong></p><ul><li>Career plan</li><li>Team lunch</li></ul>')
    expect(agenda.html).not.toContain('Salary')
  })

  it('has no Topics line without topics or when all are private', () => {
    expect(personAgenda('Priya', [], [], world, '2026-11-21').text).not.toContain('Topics')
    expect(personAgenda('Priya', [], [], world, '2026-11-21', { tasks: [topic(2, 'Salary')], hidden: [2] }).html).not.toContain('Topics')
  })
})
