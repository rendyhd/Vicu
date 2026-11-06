import { describe, expect, it } from 'vitest'
import {
  ASK_STARTERS,
  ASK_TOOLS,
  BRAIN_DUMP_ANSWER_SCHEMA,
  DICTATION_ANSWER_SCHEMA,
  ORGANIZE_ANSWER_SCHEMA,
  PLAN_DAY_ANSWER_SCHEMA,
  PROBE,
  PROMPTS,
  askSystemPrompt,
  brainDumpSystemPrompt,
  dictationSystemPrompt,
  enabledAskTools,
  promptModeSystem,
  promptText,
  repairMessage,
} from '../contract'
import { extractJsonObject, firstSchemaProblem, schemaSubsetProblems } from '../schema'
import { aiFixture } from './fixture'

// docs/ai-assistant-v1.md sections 2.2 and 8: every schema a model sees stays inside the subset,
// the app reads the fixture's own text, and prompts are joined with \n.
describe('model-facing schemas obey schemaSubset', () => {
  const schemas: Array<[string, unknown]> = [
    ['dictation.answerSchema', DICTATION_ANSWER_SCHEMA],
    ['brainDump.answerSchema', BRAIN_DUMP_ANSWER_SCHEMA],
    ['organize.answerSchema', ORGANIZE_ANSWER_SCHEMA],
    ['planDay.answerSchema', PLAN_DAY_ANSWER_SCHEMA],
    ['probe.structured.schema', PROBE.structured.schema],
    ['probe.tool.parameters', PROBE.tool.tool.parameters],
    ...ASK_TOOLS.map((tool): [string, unknown] => [`ask.tools.${tool.name}`, tool.parameters]),
  ]
  for (const [name, schema] of schemas) {
    it(name, () => {
      expect(schemaSubsetProblems(schema as never)).toEqual([])
    })
  }

  it('reads the schemas from the fixture itself', () => {
    expect(DICTATION_ANSWER_SCHEMA).toEqual(aiFixture.dictation.answerSchema)
    expect(BRAIN_DUMP_ANSWER_SCHEMA).toEqual(aiFixture.brainDump.answerSchema)
    expect(ORGANIZE_ANSWER_SCHEMA).toEqual(aiFixture.organize.answerSchema)
    expect(PLAN_DAY_ANSWER_SCHEMA).toEqual(aiFixture.planDay.answerSchema)
    expect(ASK_STARTERS).toEqual(aiFixture.ask.starters)
    expect(ASK_TOOLS).toEqual(aiFixture.ask.tools)
  })

  it('offers the enabled tools only (no propose_delete_tasks in v1)', () => {
    expect(enabledAskTools().map((t) => t.name)).not.toContain('propose_delete_tasks')
    expect(enabledAskTools()).toHaveLength(ASK_TOOLS.length - 1)
  })

  it('finds a schema problem in a broken subset schema', () => {
    expect(schemaSubsetProblems({ type: 'object', properties: { a: { type: 'string', maxLength: 3 } as never }, required: ['a'] })).toEqual([
      '$: an object needs additionalProperties false',
      '$.a: keyword "maxLength" is not in the subset',
    ])
  })
})

describe('answer validation', () => {
  it('accepts the probe answer and names the first problem otherwise', () => {
    expect(firstSchemaProblem({ answer: 5 }, PROBE.structured.schema)).toBeNull()
    expect(firstSchemaProblem({ answer: '5' }, PROBE.structured.schema)).toBe('answer must be integer, not string')
    expect(firstSchemaProblem({}, PROBE.structured.schema)).toBe('the answer is missing "answer"')
    expect(firstSchemaProblem({ answer: 5, extra: 1 }, PROBE.structured.schema)).toBe('the answer has an unknown field "extra"')
  })

  it('accepts every brain dump vector answer, and names a missing project_ref', () => {
    for (const vector of aiFixture.brainDump.checks) expect(firstSchemaProblem(vector.answer, BRAIN_DUMP_ANSWER_SCHEMA)).toBeNull()
    const broken = structuredClone(aiFixture.brainDump.checks[0].answer)
    delete broken.tasks[0].project_ref
    expect(firstSchemaProblem(broken, BRAIN_DUMP_ANSWER_SCHEMA)).toBe('tasks[0] is missing "project_ref"')
  })

  it('accepts every organize vector answer (section 9.2)', () => {
    for (const vector of aiFixture.organize.checks) expect(firstSchemaProblem(vector.answer, ORGANIZE_ANSWER_SCHEMA)).toBeNull()
  })

  it('checks nullable fields and nested drafts', () => {
    const draft = aiFixture.dictation.checks[0].answer
    expect(firstSchemaProblem(draft, DICTATION_ANSWER_SCHEMA)).toBeNull()
    const broken = structuredClone(draft)
    broken.tasks[1].when.said = 3
    expect(firstSchemaProblem(broken, DICTATION_ANSWER_SCHEMA)).toBe('tasks[1].when.said must be string or null, not integer')
    broken.tasks[1].when.said = null
    broken.tasks[0].unsure = ['date']
    expect(firstSchemaProblem(broken, DICTATION_ANSWER_SCHEMA)).toMatch(/^tasks\[0\]\.unsure\[0\] must be one of /)
  })

  it('reads JSON from the first { to the last } (prompt mode)', () => {
    expect(extractJsonObject('Sure! {"answer": 5} Hope that helps.')).toEqual({ answer: 5 })
    expect(() => extractJsonObject('no json here')).toThrow('the answer has no JSON object')
    expect(() => extractJsonObject('{"answer": }')).toThrow('the answer is not valid JSON')
  })
})

describe('prompts', () => {
  it('joins the lines with \\n and sends them exactly', () => {
    for (const name of ['dictation', 'dictationEdit', 'brainDump', 'brainDumpEdit', 'ask', 'talk', 'organize'] as const) {
      expect(promptText(name)).toBe(aiFixture.prompts[name].lines.join('\n'))
      expect(PROMPTS[name].version).toBe(aiFixture.prompts[name].version)
    }
  })

  it('has starters for every kind of list (5.7)', () => {
    for (const kind of ['today', 'upcoming', 'inbox', 'project', 'other'] as const) expect(ASK_STARTERS[kind].length).toBeGreaterThan(0)
  })

  it('adds the edit, brain dump and talk prompts after a blank line', () => {
    expect(dictationSystemPrompt(false)).toBe(promptText('dictation'))
    expect(dictationSystemPrompt(true)).toBe(`${promptText('dictation')}\n\n${promptText('dictationEdit')}`)
    expect(brainDumpSystemPrompt(false)).toBe(`${promptText('dictation')}\n\n${promptText('brainDump')}`)
    expect(brainDumpSystemPrompt(true)).toBe(`${promptText('dictation')}\n\n${promptText('brainDump')}\n\n${promptText('brainDumpEdit')}`)
    expect(askSystemPrompt(false)).toBe(promptText('ask'))
    expect(askSystemPrompt(true)).toBe(`${promptText('ask')}\n\n${promptText('talk')}`)
  })

  it('puts the schema after the intro line in prompt mode, as compact JSON in fixture order', () => {
    expect(promptModeSystem('SYSTEM', PROBE.structured.schema)).toBe(
      'SYSTEM\n\nAnswer with JSON that matches this schema:\n{"type":"object","additionalProperties":false,"required":["answer"],"properties":{"answer":{"type":"integer"}}}',
    )
  })

  it('builds the repair message from the fixture', () => {
    expect(repairMessage('answer must be integer, not string')).toBe(
      'That answer did not match the schema: answer must be integer, not string. Answer again with JSON only.',
    )
  })
})
