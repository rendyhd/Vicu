import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkPlanDayAnswer, freeAsClock, planDayUserMessage } from '../plan-day'

// docs/ai-assistant-v1.md section 10.3, the vectors both apps run.
const fixture = JSON.parse(readFileSync(join(__dirname, '../../../../test-fixtures/ai-tools-v1.json'), 'utf8')).planDay as {
  checks: {
    name: string
    free: [string, string][]
    defaultLength: number
    leftovers: number[]
    candidates: number[]
    answer: unknown
    expect: object
  }[]
}

describe('Plan my day, the checks of an answer', () => {
  for (const vector of fixture.checks) {
    it(vector.name, () => {
      const result = checkPlanDayAnswer(vector.answer, {
        free: vector.free,
        defaultLength: vector.defaultLength,
        leftovers: vector.leftovers,
        candidates: vector.candidates,
      })
      expect(result).toEqual(vector.expect)
    })
  }

  it('an answer that is not an object leaves nothing', () => {
    const empty = { leftovers: [], picks: [], can_wait: [], dropped: [] }
    const input = { free: [], defaultLength: 30, leftovers: [], candidates: [] }
    expect(checkPlanDayAnswer(null, input)).toEqual(empty)
    expect(checkPlanDayAnswer('no', input)).toEqual(empty)
  })
})

describe('Plan my day, the request', () => {
  it('spells the blocks in order, each tag on its own line', () => {
    const message = planDayUserMessage(
      '{"now":"x"}',
      { day: '2026-10-27', now: '09:10', default_length: 30, free: freeAsClock([[555, 660]]), routines: ['08:00'] },
      [{ id: 1 }],
      [{ id: 2 }],
    )
    expect(message).toBe(
      [
        '<context>',
        '{"now":"x"}',
        '</context>',
        '<plan>',
        '{"day":"2026-10-27","now":"09:10","default_length":30,"free":[{"start":"09:15","end":"11:00"}],"routines":["08:00"]}',
        '</plan>',
        '<leftovers>',
        '[{"id":1}]',
        '</leftovers>',
        '<candidates>',
        '[{"id":2}]',
        '</candidates>',
      ].join('\n'),
    )
  })

  it('sends at most the candidate limit', () => {
    const many = Array.from({ length: 60 }, (_, id) => ({ id }))
    const message = planDayUserMessage('{}', { day: 'd', now: 'n', default_length: 30, free: [], routines: [] }, many, many)
    const blocks = message.match(/\[\{.*\}\]/g) ?? []
    expect(JSON.parse(blocks[0] as string)).toHaveLength(40)
    expect(JSON.parse(blocks[1] as string)).toHaveLength(40)
  })
})
