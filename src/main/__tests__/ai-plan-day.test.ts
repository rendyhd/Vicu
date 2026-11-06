import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normaliseAiSettings } from '../../shared/ai/settings'
import { AI_LIMITS, PLAN_DAY_ANSWER_SCHEMA, promptText } from '../../shared/ai/contract'
import type { AiSettings } from '../../shared/ai/types'
import type { HttpRequest, HttpResponse, Transport } from '../ai/transport'

// docs/ai-assistant-v1.md section 10: Plan my day's suggestions are asked of Ask's model, with the
// `planDay` prompt and schema, deterministic, under Ask's agreement.

let settings: AiSettings
vi.mock('../ai/settings-store', () => ({
  getAiSettings: () => settings,
  getProviderKey: () => null,
  updateAiSettings: vi.fn(),
}))

const { aiPlanDay, setAiTransport } = await import('../ai/service')

function answering(body: unknown) {
  const requests: Array<Record<string, unknown>> = []
  const transport: Transport = async (request: HttpRequest) => {
    requests.push(request.body ? JSON.parse(request.body) : {})
    const text = JSON.stringify(body)
    const stream = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
    const response: HttpResponse = {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: (async function* () { yield Buffer.from(stream) })(),
    }
    return response
  }
  return { transport, requests }
}

const answer = { leftovers: [], picks: [], can_wait: [] }
const user = '<plan>\n{}\n</plan>'

describe('aiPlanDay', () => {
  beforeEach(() => {
    settings = normaliseAiSettings({
      provider: 'ollama',
      address: 'http://localhost:11434/v1',
      models: { dictation: 'small-model', ask: 'ask-model' },
      features: { dictation: true, ask: true },
      tested: { 'ollama|http://localhost:11434/v1|ask-model': { structured: 'json_schema', tools: true } },
    })
  })

  it("asks Ask's model with the planDay prompt and schema", async () => {
    const { transport, requests } = answering(answer)
    setAiTransport(transport)
    const result = await aiPlanDay({ user })
    expect(result).toEqual({ success: true, data: answer })
    const body = requests[0]
    expect(body.model).toBe('ask-model')
    expect(body.temperature).toBe(0)
    const messages = body.messages as Array<{ role: string; content: string }>
    expect(messages[0]).toEqual({ role: 'system', content: promptText('planDay') })
    expect(messages[1]).toEqual({ role: 'user', content: user })
    const format = body.response_format as { json_schema: { schema: unknown } }
    expect(format.json_schema.schema).toEqual(PLAN_DAY_ANSWER_SCHEMA)
    setAiTransport(null)
  })

  it('has a limit of its own in the fixture', () => {
    expect(AI_LIMITS.plan_day_max_tokens).toBeGreaterThan(0)
  })

  it('needs an Ask model', async () => {
    settings = { ...settings, models: { dictation: 'small-model', ask: '' } }
    const result = await aiPlanDay({ user: 'x' })
    expect(result).toMatchObject({ success: false, error: { kind: 'not_set_up' } })
  })

  it('needs the agreement of a cloud provider', async () => {
    settings = normaliseAiSettings({ provider: 'openrouter', models: { ask: 'ask-model' }, features: { ask: true } })
    const result = await aiPlanDay({ user: 'x' })
    expect(result.success).toBe(false)
  })
})
