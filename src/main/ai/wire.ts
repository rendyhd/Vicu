/**
 * The two wire protocols of docs/ai-assistant-v1.md section 2 (`protocols` in the fixture): how a
 * request body is written and how a streamed (or whole) answer is read back into a provider-neutral
 * assistant message. Pure, so recorded streams test it.
 *
 * - `openai-chat`: Chat Completions with `stream: true`; tool calls arrive in pieces by `index` and
 *   are assembled per call; structured answers use `response_format` `json_schema` (`strict: true`,
 *   name `answer`); tools are sent without `strict`; no max-tokens field.
 * - `anthropic-messages`: the Messages API with `stream: true`; `tool_use` blocks with
 *   `input_json_delta` pieces; structured answers through `output_config.format`; the lowest effort
 *   through `output_config.effort`; no `temperature` and no `thinking`; assistant turns go back with
 *   their content blocks as received; tool results join into one user turn.
 * - A forced tool choice is never sent (2.3).
 */
import { promptModeSystem, type JsonSchema, type StructuredMode, type WireProtocol } from '../../shared/ai/contract'
import type { ChatMessage, ToolCall, ToolSpec } from '../../shared/ai/types'

export interface ChatRequest {
  model: string
  system: string
  messages: ChatMessage[]
  tools: ToolSpec[]
  /** A structured answer (dictation, the probe). */
  schema?: JsonSchema
  structuredMode?: StructuredMode
  /** Dictation and repair: temperature 0 (openai-chat) and the lowest reasoning effort (2.5). */
  deterministic: boolean
  /** anthropic-messages only. */
  maxTokens: number
  /**
   * The last round of an Ask turn (5.5) on anthropic-messages, whose history holds tool blocks: the
   * tools stay defined (the API refuses tool blocks without them) and `tool_choice` is `none`.
   */
  toolsOff?: boolean
}

/** Optional fields a model may refuse with a 400; left out for that model afterwards. */
export const OPTIONAL_FIELDS = ['temperature', 'reasoning_effort', 'effort', 'detail'] as const
export type OptionalField = (typeof OPTIONAL_FIELDS)[number]

export class ProviderAnswerError extends Error {
  constructor(readonly kind: 'server' | 'refused' | 'bad_answer', message: string) {
    super(message)
  }
}

export type AssistantMessage = Extract<ChatMessage, { role: 'assistant' }>

export interface AnswerReader {
  /** One SSE `data`; returns the text added, if any. */
  onData(data: string): string | null
  /** A whole JSON answer (a server that ignored `stream`). */
  onWhole(body: string): string | null
  finish(): { message: AssistantMessage; stopReason: string | null }
}

export interface WireProtocolImpl {
  body(request: ChatRequest, omit: ReadonlySet<string>): Record<string, unknown>
  reader(): AnswerReader
}

/** The system text: in prompt mode the schema follows it (2.2). */
export function systemText(request: ChatRequest): string {
  if (request.schema && request.structuredMode === 'prompt') return promptModeSystem(request.system, request.schema)
  return request.system
}

const SCHEMA_NAME = 'answer'

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** The readable message of a provider's error object. */
export function providerErrorText(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error
  const object = asObject(error)
  if (object) {
    if (typeof object.message === 'string' && object.message.trim()) return object.message
    if (object.error !== undefined) return providerErrorText(object.error)
  }
  return 'The provider reported an error.'
}

// --- openai-chat -------------------------------------------------------------------------

export const openAiChat: WireProtocolImpl = {
  body(request, omit) {
    const messages: unknown[] = []
    const system = systemText(request)
    if (system) messages.push({ role: 'system', content: system })
    for (const message of request.messages) {
      if (message.role === 'user') {
        // Pictures (4.9.2) make the content a list of parts: the images, then the text.
        if (message.images && message.images.length > 0) {
          const parts: unknown[] = message.images.map((image) => ({
            type: 'image_url',
            image_url: { url: `data:${image.media_type};base64,${image.data}`, ...(omit.has('detail') ? {} : { detail: 'high' }) },
          }))
          parts.push({ type: 'text', text: message.text })
          messages.push({ role: 'user', content: parts })
        } else {
          messages.push({ role: 'user', content: message.text })
        }
      } else if (message.role === 'assistant') {
        const entry: Record<string, unknown> = {
          role: 'assistant',
          content: message.text === '' && message.toolCalls.length > 0 ? null : message.text,
        }
        if (message.toolCalls.length > 0) {
          entry.tool_calls = message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
          }))
        }
        messages.push(entry)
      } else {
        for (const result of message.results) {
          messages.push({ role: 'tool', tool_call_id: result.callId, content: result.content })
        }
      }
    }
    const body: Record<string, unknown> = { model: request.model, stream: true, messages }
    if (request.tools.length > 0 && !request.toolsOff) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }))
    }
    if (request.schema && request.structuredMode === 'json_schema') {
      body.response_format = { type: 'json_schema', json_schema: { name: SCHEMA_NAME, strict: true, schema: request.schema } }
    }
    if (request.deterministic) {
      if (!omit.has('temperature')) body.temperature = 0
      if (!omit.has('reasoning_effort')) body.reasoning_effort = 'low'
    }
    return body
  },

  reader() {
    let text = ''
    let stopReason: string | null = null
    const calls = new Map<number, { id: string | null; name: string; arguments: string }>()

    const readCalls = (holder: Record<string, unknown>) => {
      const list = Array.isArray(holder.tool_calls) ? holder.tool_calls : []
      list.forEach((element, position) => {
        const call = asObject(element)
        if (!call) return
        const index = typeof call.index === 'number' ? call.index : position
        let partial = calls.get(index)
        if (!partial) {
          partial = { id: null, name: '', arguments: '' }
          calls.set(index, partial)
        }
        if (typeof call.id === 'string' && call.id !== '') partial.id = call.id
        const fn = asObject(call.function)
        if (!fn) return
        if (typeof fn.name === 'string' && fn.name !== '') partial.name = fn.name
        if (typeof fn.arguments === 'string') partial.arguments += fn.arguments
        else if (asObject(fn.arguments)) partial.arguments += JSON.stringify(fn.arguments)
      })
    }

    const readChoice = (o: Record<string, unknown>, whole: boolean): string | null => {
      if (o.error !== undefined) throw new ProviderAnswerError('server', providerErrorText(o.error))
      const choice = asObject(Array.isArray(o.choices) ? o.choices[0] : undefined)
      if (!choice) return null
      if (typeof choice.finish_reason === 'string') stopReason = choice.finish_reason
      const delta = asObject(whole ? choice.message : (choice.delta ?? choice.message))
      if (!delta) return null
      readCalls(delta)
      const piece = typeof delta.content === 'string' ? delta.content : ''
      text += piece
      return piece || null
    }

    return {
      onData(data) {
        if (data.trim() === '[DONE]') return null
        const o = asObject(parseJson(data))
        return o ? readChoice(o, false) : null
      },
      onWhole(body) {
        const o = asObject(parseJson(body))
        if (!o) throw new ProviderAnswerError('bad_answer', 'The answer could not be read.')
        return readChoice(o, true)
      },
      finish() {
        if (stopReason === 'content_filter') throw new ProviderAnswerError('refused', 'The model declined to answer.')
        const toolCalls: ToolCall[] = []
        for (const [index, call] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
          if (call.name === '') continue
          toolCalls.push({ id: call.id ?? `call_${index}`, name: call.name, arguments: call.arguments })
        }
        return { message: { role: 'assistant', text, toolCalls }, stopReason }
      },
    }
  },
}

// --- anthropic-messages ------------------------------------------------------------------

const textBlock = (text: string) => ({ type: 'text', text })

export const anthropicMessages: WireProtocolImpl = {
  body(request, omit) {
    const turns: Array<{ role: 'user' | 'assistant'; content: unknown[] }> = []
    const add = (role: 'user' | 'assistant', blocks: unknown[]) => {
      const last = turns[turns.length - 1]
      if (last && last.role === role) last.content.push(...blocks)
      else turns.push({ role, content: [...blocks] })
    }
    for (const message of request.messages) {
      if (message.role === 'user') {
        const images = (message.images ?? []).map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } }))
        add('user', [...images, textBlock(message.text || ' ')])
      } else if (message.role === 'assistant') {
        if (message.raw && message.raw.length > 0) {
          add('assistant', message.raw)
        } else {
          const blocks: unknown[] = []
          if (message.text) blocks.push(textBlock(message.text))
          for (const call of message.toolCalls) {
            blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: asObject(parseJson(call.arguments)) ?? {} })
          }
          add('assistant', blocks.length > 0 ? blocks : [textBlock(' ')])
        }
      } else {
        add('user', message.results.map((result) => ({
          type: 'tool_result',
          tool_use_id: result.callId,
          content: result.content,
          ...(result.isError ? { is_error: true } : {}),
        })))
      }
    }
    const body: Record<string, unknown> = { model: request.model, max_tokens: request.maxTokens, stream: true }
    const system = systemText(request)
    if (system) body.system = system
    body.messages = turns
    if (request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }))
      if (request.toolsOff) body.tool_choice = { type: 'none' }
    }
    const schema = request.schema && request.structuredMode === 'json_schema' ? request.schema : null
    const effort = request.deterministic && !omit.has('effort')
    if (schema || effort) {
      const config: Record<string, unknown> = {}
      if (schema) config.format = { type: 'json_schema', schema }
      if (effort) config.effort = 'low'
      body.output_config = config
    }
    return body
  },

  reader() {
    interface Block {
      type: string
      start: Record<string, unknown>
      text: string
      input: string
      thinking: string
      signature: string | null
    }
    const blocks = new Map<number, Block>()
    let stopReason: string | null = null

    const startBlock = (index: number, block: Record<string, unknown>): Block => {
      const started: Block = {
        type: typeof block.type === 'string' ? block.type : 'unknown',
        start: block,
        text: typeof block.text === 'string' ? block.text : '',
        input: '',
        thinking: typeof block.thinking === 'string' ? block.thinking : '',
        signature: typeof block.signature === 'string' ? block.signature : null,
      }
      blocks.set(index, started)
      return started
    }

    return {
      onData(data) {
        const o = asObject(parseJson(data))
        if (!o) return null
        switch (o.type) {
          case 'error':
            throw new ProviderAnswerError('server', providerErrorText(o.error ?? o))
          case 'content_block_start': {
            const block = asObject(o.content_block)
            if (!block) return null
            const started = startBlock(typeof o.index === 'number' ? o.index : blocks.size, block)
            return started.type === 'text' && started.text ? started.text : null
          }
          case 'content_block_delta': {
            const block = typeof o.index === 'number' ? blocks.get(o.index) : undefined
            const delta = asObject(o.delta)
            if (!block || !delta) return null
            switch (delta.type) {
              case 'text_delta': {
                const piece = typeof delta.text === 'string' ? delta.text : ''
                block.text += piece
                return piece || null
              }
              case 'input_json_delta':
                block.input += typeof delta.partial_json === 'string' ? delta.partial_json : ''
                return null
              case 'thinking_delta':
                block.thinking += typeof delta.thinking === 'string' ? delta.thinking : ''
                return null
              case 'signature_delta':
                block.signature = typeof delta.signature === 'string' ? delta.signature : block.signature
                return null
            }
            return null
          }
          case 'message_delta': {
            const delta = asObject(o.delta)
            if (delta && typeof delta.stop_reason === 'string') stopReason = delta.stop_reason
            return null
          }
          default:
            return null
        }
      },
      onWhole(body) {
        const o = asObject(parseJson(body))
        if (!o) throw new ProviderAnswerError('bad_answer', 'The answer could not be read.')
        if (o.type === 'error') throw new ProviderAnswerError('server', providerErrorText(o.error ?? o))
        stopReason = typeof o.stop_reason === 'string' ? o.stop_reason : null
        let added = ''
        ;(Array.isArray(o.content) ? o.content : []).forEach((element, index) => {
          const block = asObject(element)
          if (!block) return
          const started = startBlock(index, block)
          if (started.type === 'tool_use') started.input = JSON.stringify(block.input ?? {})
          if (started.type === 'text') added += started.text
        })
        return added || null
      },
      finish() {
        if (stopReason === 'refusal') throw new ProviderAnswerError('refused', 'The model declined to answer.')
        let text = ''
        const toolCalls: ToolCall[] = []
        const raw: unknown[] = []
        for (const [, block] of [...blocks.entries()].sort((a, b) => a[0] - b[0])) {
          switch (block.type) {
            case 'text':
              text += block.text
              raw.push(textBlock(block.text))
              break
            case 'tool_use': {
              const id = typeof block.start.id === 'string' ? block.start.id : ''
              const name = typeof block.start.name === 'string' ? block.start.name : ''
              // A tool call cut off by max_tokens keeps its broken arguments: the caller answers
              // them with invalid_arguments (2.3).
              const args = block.input.trim() === '' ? (stopReason === 'max_tokens' ? '' : '{}') : block.input
              toolCalls.push({ id, name, arguments: args })
              raw.push({ type: 'tool_use', id, name, input: asObject(parseJson(args)) ?? {} })
              break
            }
            case 'thinking':
              raw.push({ type: 'thinking', thinking: block.thinking, signature: block.signature ?? '' })
              break
            default:
              // Redacted thinking or a newer block type goes back as it came.
              raw.push(block.start)
          }
        }
        return { message: { role: 'assistant', text, toolCalls, raw }, stopReason }
      },
    }
  },
}

export function wireProtocol(protocol: WireProtocol): WireProtocolImpl {
  return protocol === 'anthropic-messages' ? anthropicMessages : openAiChat
}

/** The optional field a 400 answer names, to leave out and try once more. */
export function refusedOptionalField(message: string, protocol: WireProtocol, sent: Record<string, unknown>): OptionalField | null {
  const text = message.toLowerCase()
  if (protocol === 'openai-chat') {
    if ('reasoning_effort' in sent && (text.includes('reasoning_effort') || text.includes('reasoning effort'))) return 'reasoning_effort'
    if ('temperature' in sent && text.includes('temperature')) return 'temperature'
    if (text.includes('detail') && JSON.stringify(sent.messages ?? []).includes('"detail":"high"')) return 'detail'
    return null
  }
  const config = asObject(sent.output_config)
  if (config && 'effort' in config && text.includes('effort')) return 'effort'
  return null
}
