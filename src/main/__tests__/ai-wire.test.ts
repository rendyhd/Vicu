import { describe, expect, it } from 'vitest'
import { SseReader } from '../ai/sse'
import { anthropicMessages, openAiChat, refusedOptionalField, type ChatRequest } from '../ai/wire'
import { AiFailure, listModels, runChat, type ProviderConnection } from '../ai/client'
import { structuredAnswer } from '../ai/structured'
import type { HttpRequest, HttpResponse, Transport } from '../ai/transport'
import { DICTATION_ANSWER_SCHEMA, PROBE, promptModeSystem } from '../../shared/ai/contract'
import { readFileSync } from 'fs'
import { join } from 'path'

// docs/ai-assistant-v1.md section 2: both wire protocols against recorded (made-up) streams, tool
// calls assembled per id, structured answers and the one repair request, the optional fields a
// model refuses.

function sse(events: Array<Record<string, unknown> | string>, named = false): string {
  return events.map((e) => {
    const data = typeof e === 'string' ? e : JSON.stringify(e)
    const name = named && typeof e !== 'string' ? `event: ${(e as { type: string }).type}\n` : ''
    return `${name}data: ${data}\n\n`
  }).join('')
}

/** A transport that answers each request with the next canned response, split into small chunks. */
function fakeTransport(responses: Array<{ status?: number; body: string; type?: string }>) {
  const requests: Array<HttpRequest & { json: Record<string, unknown> }> = []
  const transport: Transport = async (request) => {
    requests.push({ ...request, json: request.body ? JSON.parse(request.body) : {} })
    const next = responses.shift()
    if (!next) throw new Error('no more responses')
    const bytes = Buffer.from(next.body)
    const response: HttpResponse = {
      status: next.status ?? 200,
      headers: { 'content-type': next.type ?? (next.status && next.status >= 400 ? 'application/json' : 'text/event-stream') },
      body: (async function* () {
        for (let i = 0; i < bytes.length; i += 7) yield bytes.subarray(i, i + 7)
      })(),
    }
    return response
  }
  return { transport, requests }
}

const openai: ProviderConnection = { protocol: 'openai-chat', address: 'http://localhost:11434/v1', headers: {} }
const anthropic: ProviderConnection = { protocol: 'anthropic-messages', address: 'https://api.anthropic.com/v1', headers: { 'x-api-key': 'k', 'anthropic-version': '2023-06-01' } }

const baseRequest: ChatRequest = { model: 'm', system: 'SYS', messages: [{ role: 'user', text: 'hi' }], tools: [], deterministic: false, maxTokens: 16000 }

describe('SSE reader', () => {
  it('joins data lines, skips comments, handles CRLF and split chunks', () => {
    const reader = new SseReader()
    const events = [
      ...reader.feed(': keep-alive\r\nevent: a\r\ndata: one\r\ndata: two\r'),
      ...reader.feed('\n\r\ndata: {"x":1}\n'),
      ...reader.feed('\n'),
    ]
    expect(events).toEqual([{ event: 'a', data: 'one\ntwo' }, { event: null, data: '{"x":1}' }])
    expect(reader.feed('data: last')).toEqual([])
    expect(reader.end()).toEqual([{ event: null, data: 'last' }])
  })
})

describe('openai-chat', () => {
  it('writes the body: system first, tools without strict, structured answer named answer, deterministic fields', () => {
    const body = openAiChat.body({
      ...baseRequest,
      tools: [PROBE.tool.tool],
      schema: PROBE.structured.schema,
      structuredMode: 'json_schema',
      deterministic: true,
      messages: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: '', toolCalls: [{ id: 'c1', name: 'add_numbers', arguments: '{"a":2,"b":3}' }] },
        { role: 'tool', results: [{ callId: 'c1', name: 'add_numbers', content: '{"sum":5}' }] },
      ],
    }, new Set())
    expect(body).toEqual({
      model: 'm',
      stream: true,
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'add_numbers', arguments: '{"a":2,"b":3}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: '{"sum":5}' },
      ],
      tools: [{ type: 'function', function: { name: 'add_numbers', description: 'Adds two whole numbers.', parameters: PROBE.tool.tool.parameters } }],
      response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: PROBE.structured.schema } },
      temperature: 0,
      reasoning_effort: 'low',
    })
    expect(body).not.toHaveProperty('tool_choice')
    expect(body).not.toHaveProperty('max_tokens')
  })

  it('puts the schema in the system prompt in prompt mode', () => {
    const body = openAiChat.body({ ...baseRequest, schema: PROBE.structured.schema, structuredMode: 'prompt' }, new Set(['temperature']))
    expect((body.messages as Array<{ content: string }>)[0].content).toBe(promptModeSystem('SYS', PROBE.structured.schema))
    expect(body).not.toHaveProperty('response_format')
  })

  it('assembles streamed tool calls per index, arguments in pieces', async () => {
    const stream = sse([
      { choices: [{ delta: { role: 'assistant', content: 'Let me look. ' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'find_tasks', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'get_task', arguments: '{"task_' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"text":"milk"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: 'id":7}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] }, finish_reason: 'tool_calls' }] },
      '[DONE]',
    ])
    const { transport, requests } = fakeTransport([{ body: stream }])
    const texts: string[] = []
    const { message, stopReason } = await runChat(openai, baseRequest, { transport, idleTimeoutMs: 1000, onText: (t) => texts.push(t) })
    expect(requests[0].url).toBe('http://localhost:11434/v1/chat/completions')
    expect(texts.join('')).toBe('Let me look. ')
    expect(stopReason).toBe('tool_calls')
    expect(message.toolCalls).toEqual([
      { id: 'call_a', name: 'find_tasks', arguments: '{"text":"milk"}' },
      { id: 'call_b', name: 'get_task', arguments: '{"task_id":7}' },
    ])
  })

  it('takes whole arguments and answers without stream', async () => {
    const whole = JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'x', function: { name: 'add_numbers', arguments: { a: 2, b: 3 } } }] }, finish_reason: 'tool_calls' }] })
    const { transport } = fakeTransport([{ body: whole, type: 'application/json' }])
    const { message } = await runChat(openai, baseRequest, { transport, idleTimeoutMs: 1000 })
    expect(message.toolCalls).toEqual([{ id: 'x', name: 'add_numbers', arguments: '{"a":2,"b":3}' }])
  })

  it('tries once more without a field the model refused, and reports it', async () => {
    const { transport, requests } = fakeTransport([
      { status: 400, body: JSON.stringify({ error: { message: "Unsupported parameter: 'temperature' is not supported with this model." } }) },
      { status: 400, body: JSON.stringify({ error: { message: 'Unrecognized request argument supplied: reasoning_effort' } }) },
      { body: sse([{ choices: [{ delta: { content: '{"answer":5}' }, finish_reason: 'stop' }] }, '[DONE]']) },
    ])
    const refused: string[] = []
    const { message } = await runChat(openai, { ...baseRequest, deterministic: true }, { transport, idleTimeoutMs: 1000, onRefused: (f) => refused.push(f) })
    expect(message.text).toBe('{"answer":5}')
    expect(refused).toEqual(['temperature', 'reasoning_effort'])
    expect(requests[2].json).not.toHaveProperty('temperature')
    expect(requests[2].json).not.toHaveProperty('reasoning_effort')
  })

  it('turns an error answer into a failure of the right kind', async () => {
    const { transport } = fakeTransport([{ status: 401, body: JSON.stringify({ error: { message: 'Incorrect API key provided' } }) }])
    await expect(runChat(openai, baseRequest, { transport, idleTimeoutMs: 1000 })).rejects.toMatchObject({ kind: 'auth', message: 'Incorrect API key provided' })
  })
})

describe('anthropic-messages', () => {
  it('writes the body: output_config with format and effort, no temperature, tool results in one user turn', () => {
    const body = anthropicMessages.body({
      ...baseRequest,
      schema: DICTATION_ANSWER_SCHEMA,
      structuredMode: 'json_schema',
      deterministic: true,
      maxTokens: 8192,
      tools: [PROBE.tool.tool],
      messages: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'ok', toolCalls: [{ id: 't1', name: 'add_numbers', arguments: '{"a":2' }, { id: 't2', name: 'add_numbers', arguments: '{"a":1,"b":1}' }] },
        { role: 'tool', results: [{ callId: 't1', name: 'add_numbers', content: '{"error":"invalid_arguments"}', isError: true }, { callId: 't2', name: 'add_numbers', content: '2' }] },
        { role: 'user', text: 'and then?' },
      ],
    }, new Set())
    expect(body.max_tokens).toBe(8192)
    expect(body.system).toBe('SYS')
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('tool_choice')
    expect(body.output_config).toEqual({ format: { type: 'json_schema', schema: DICTATION_ANSWER_SCHEMA }, effort: 'low' })
    expect(body.tools).toEqual([{ name: 'add_numbers', description: 'Adds two whole numbers.', input_schema: PROBE.tool.tool.parameters }])
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'add_numbers', input: {} }, { type: 'tool_use', id: 't2', name: 'add_numbers', input: { a: 1, b: 1 } }] },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: '{"error":"invalid_arguments"}', is_error: true },
          { type: 'tool_result', tool_use_id: 't2', content: '2' },
          { type: 'text', text: 'and then?' },
        ],
      },
    ])
  })

  it('leaves effort out once refused, and keeps the tools with tool_choice none on the last round', () => {
    const body = anthropicMessages.body({ ...baseRequest, deterministic: true, tools: [PROBE.tool.tool], toolsOff: true }, new Set(['effort']))
    expect(body).not.toHaveProperty('output_config')
    expect(body.tool_choice).toEqual({ type: 'none' })
  })

  it('assembles tool_use blocks and replays the content exactly, thinking and signature included', async () => {
    const stream = sse([
      { type: 'message_start', message: { id: 'msg', role: 'assistant', content: [] } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Look it up.' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig==' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Checking.' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'find_tasks', input: {} } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"text":' } },
      { type: 'ping' },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"milk"}' } },
      { type: 'content_block_stop', index: 2 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
      { type: 'message_stop' },
    ], true)
    const { transport, requests } = fakeTransport([{ body: stream }])
    const { message, stopReason } = await runChat(anthropic, baseRequest, { transport, idleTimeoutMs: 1000 })
    expect(requests[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect(requests[0].headers['x-api-key']).toBe('k')
    expect(requests[0].headers['anthropic-version']).toBe('2023-06-01')
    expect(stopReason).toBe('tool_use')
    expect(message.text).toBe('Checking.')
    expect(message.toolCalls).toEqual([{ id: 'toolu_1', name: 'find_tasks', arguments: '{"text":"milk"}' }])
    expect(message.raw).toEqual([
      { type: 'thinking', thinking: 'Look it up.', signature: 'sig==' },
      { type: 'text', text: 'Checking.' },
      { type: 'tool_use', id: 'toolu_1', name: 'find_tasks', input: { text: 'milk' } },
    ])
    // Sent back as received.
    const replay = anthropicMessages.body({ ...baseRequest, messages: [{ role: 'user', text: 'q' }, message] }, new Set()) as { messages: Array<{ content: unknown }> }
    expect(replay.messages[1].content).toEqual(message.raw)
  })

  it('treats a refusal as a failed request and a tool call cut off by max_tokens as invalid arguments', async () => {
    const refusal = sse([{ type: 'message_delta', delta: { stop_reason: 'refusal' } }, { type: 'message_stop' }])
    const cut = sse([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'find_tasks', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"text":"mi' } },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
    ])
    const { transport } = fakeTransport([{ body: refusal }, { body: cut }])
    await expect(runChat(anthropic, baseRequest, { transport, idleTimeoutMs: 1000 })).rejects.toMatchObject({ kind: 'refused' })
    const { message } = await runChat(anthropic, baseRequest, { transport, idleTimeoutMs: 1000 })
    expect(() => JSON.parse(message.toolCalls[0].arguments)).toThrow()
  })

  it('reads an error event in the stream', async () => {
    const { transport } = fakeTransport([{ body: sse([{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]) }])
    await expect(runChat(anthropic, baseRequest, { transport, idleTimeoutMs: 1000 })).rejects.toMatchObject({ kind: 'server', message: 'Overloaded' })
  })

  it('pages the model list with after_id', async () => {
    const { transport, requests } = fakeTransport([
      { body: JSON.stringify({ data: [{ id: 'a', display_name: 'A' }], has_more: true, last_id: 'a' }), type: 'application/json' },
      { body: JSON.stringify({ data: [{ id: 'b', display_name: 'B' }], has_more: false, last_id: 'b' }), type: 'application/json' },
    ])
    expect(await listModels(anthropic, transport)).toEqual(['a', 'b'])
    expect(requests[1].url).toBe('https://api.anthropic.com/v1/models?limit=1000&after_id=a')
    expect(requests[0].headers['x-api-key']).toBe('k')
  })
})

describe('structured answers and repair', () => {
  const answer = (text: string) => sse([{ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }, '[DONE]'])

  it('sends one repair request with the model answer and the first problem', async () => {
    const { transport, requests } = fakeTransport([{ body: answer('{"answer":"five"}') }, { body: answer('{"answer":5}') }])
    const value = await structuredAnswer(openai, { model: 'm', system: 'S', user: 'What is 2 + 3?', schema: PROBE.structured.schema, mode: 'json_schema', maxTokens: 100 }, { transport, idleTimeoutMs: 1000 })
    expect(value).toEqual({ answer: 5 })
    const messages = requests[1].json.messages as Array<{ role: string; content: string }>
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'What is 2 + 3?' },
      { role: 'assistant', content: '{"answer":"five"}' },
      { role: 'user', content: 'That answer did not match the schema: answer must be integer, not string. Answer again with JSON only.' },
    ])
  })

  it('fails after a second bad answer', async () => {
    const { transport, requests } = fakeTransport([{ body: answer('not json') }, { body: answer('still not') }])
    await expect(structuredAnswer(openai, { model: 'm', system: 'S', user: 'q', schema: PROBE.structured.schema, mode: 'prompt', maxTokens: 100 }, { transport, idleTimeoutMs: 1000 }))
      .rejects.toBeInstanceOf(AiFailure)
    expect(requests).toHaveLength(2)
    expect((requests[1].json.messages as Array<{ content: string }>)[3].content).toBe('That answer did not match the schema: the answer has no JSON object. Answer again with JSON only.')
  })

  it('reads a prompt-mode answer from the first { to the last }', async () => {
    const { transport } = fakeTransport([{ body: answer('Here you go: {"answer": 5}. Done') }])
    expect(await structuredAnswer(openai, { model: 'm', system: 'S', user: 'q', schema: PROBE.structured.schema, mode: 'prompt', maxTokens: 100 }, { transport, idleTimeoutMs: 1000 })).toEqual({ answer: 5 })
  })
})

describe('pictures in a user message (4.9.2, notes.wire vectors)', () => {
  const fixture = JSON.parse(readFileSync(join(__dirname, '../../../test-fixtures/ai-tools-v1.json'), 'utf8'))
  for (const vector of fixture.notes.wire) {
    it(`${vector.protocol}${vector.omit.length ? ` without ${vector.omit.join(', ')}` : ''}`, () => {
      const request: ChatRequest = { ...baseRequest, system: 's', messages: [vector.message] }
      const body = (vector.protocol === 'openai-chat' ? openAiChat : anthropicMessages).body(request, new Set(vector.omit)) as { messages: unknown[] }
      expect(body.messages[vector.protocol === 'openai-chat' ? 1 : 0]).toEqual(vector.expect)
    })
  }

  it('leaves "detail" out after a 400 that names it', () => {
    const request: ChatRequest = { ...baseRequest, messages: [{ role: 'user', text: 'x', images: [{ media_type: 'image/png', data: 'AA' }] }] }
    const sent = openAiChat.body(request, new Set())
    expect(refusedOptionalField("Unrecognized request argument supplied: detail", 'openai-chat', sent)).toBe('detail')
    expect(refusedOptionalField('Unrecognized request argument supplied: detail', 'openai-chat', openAiChat.body(baseRequest, new Set()))).toBeNull()
  })

  it('sends a plain string when there are no pictures', () => {
    expect((openAiChat.body(baseRequest, new Set()) as { messages: Array<{ content: unknown }> }).messages[1].content).toBe('hi')
  })
})
