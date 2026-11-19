/**
 * Structured answers (docs/ai-assistant-v1.md section 2.2): the request in the model's structured
 * mode (`json_schema`, or `prompt` with the schema at the end of the system prompt), the answer
 * read from the first `{` to the last `}` and checked against the schema, and one repair request
 * when it does not match. A second failure is a failed request (4.6).
 */
import { AI_LIMITS, repairMessage, type JsonSchema, type StructuredMode } from '../../shared/ai/contract'
import { extractJsonObject, firstSchemaProblem } from '../../shared/ai/schema'
import type { ChatImage, ChatMessage } from '../../shared/ai/types'
import { AiFailure, runChat, type ProviderConnection, type RunChatOptions } from './client'

export interface StructuredRequest {
  model: string
  system: string
  user: string
  /** Pictures before the user text (the image probe, 2.4). */
  images?: ChatImage[]
  schema: JsonSchema
  mode: StructuredMode
  maxTokens: number
}

/** The answer's problem against the schema, or null; `value` is the parsed answer. */
export function readStructured(text: string, schema: JsonSchema): { value: unknown; problem: string | null } {
  let value: unknown
  try {
    value = extractJsonObject(text)
  } catch (err) {
    return { value: undefined, problem: err instanceof Error ? err.message : 'the answer is not JSON' }
  }
  return { value, problem: firstSchemaProblem(value, schema) }
}

export async function structuredAnswer(
  connection: ProviderConnection,
  request: StructuredRequest,
  options: Omit<RunChatOptions, 'onText'>,
): Promise<unknown> {
  const messages: ChatMessage[] = [{ role: 'user', text: request.user, ...(request.images?.length ? { images: request.images } : {}) }]
  for (let attempt = 0; attempt <= AI_LIMITS.repair_attempts; attempt++) {
    const { message } = await runChat(connection, {
      model: request.model,
      system: request.system,
      messages,
      tools: [],
      schema: request.schema,
      structuredMode: request.mode,
      deterministic: true,
      maxTokens: request.maxTokens,
    }, options)
    const { value, problem } = readStructured(message.text, request.schema)
    if (problem === null) return value
    if (attempt === AI_LIMITS.repair_attempts) throw new AiFailure('bad_answer', `The answer did not match: ${problem}.`)
    // The same request with the model's answer added and the repair message (2.2).
    messages.push({ role: 'assistant', text: message.text, toolCalls: [] }, { role: 'user', text: repairMessage(problem) })
  }
  throw new AiFailure('bad_answer', 'The answer did not match.')
}
