/**
 * The assistant's provider work in the main process (docs/ai-assistant-v1.md sections 2, 4 and 5):
 * the model list, Test connection, the dictation and brain dump requests and Ask turns. The key never leaves this
 * process. Nothing is sent before a provider is set up and, for a cloud provider, the user agreed
 * (7.1).
 */
import {
  AI_LIMITS,
  AI_MESSAGES,
  BRAIN_DUMP_ANSWER_SCHEMA,
  DICTATION_ANSWER_SCHEMA,
  NOTES_ANSWER_SCHEMA,
  ORGANIZE_ANSWER_SCHEMA,
  PLAN_DAY_ANSWER_SCHEMA,
  PROBE,
  PRO_AI,
  askSystemPrompt,
  brainDumpSystemPrompt,
  dictationSystemPrompt,
  enabledAskTools,
  notesSystemPrompt,
  promptText,
  providerPreset,
  type JsonSchema,
  type StructuredMode,
} from '../../shared/ai/contract'
import { ADDRESS_HINT_STATUSES, capabilitiesOf, effectiveAddress, hasConsent, hasImagesConsent, isSetUp, mayLackVersionPath, modelKey, readingModel } from '../../shared/ai/settings'
import { readPageAnswer, readPageUserText } from '../../shared/ai/notes'
import { extractJsonObject } from '../../shared/ai/schema'
import type {
  AiError,
  AiResult,
  AiSettings,
  AskTurnEvent,
  AskTurnRequest,
  ChatImage,
  ConnectionTestResult,
  ToolSpec,
} from '../../shared/ai/types'
import { AiFailure, listModels, providerConnection, runChat, type ProviderConnection } from './client'
import { getAiSettings, getProviderKey, updateAiSettings } from './settings-store'
import { structuredAnswer } from './structured'
import { nodeTransport, type Transport } from './transport'

export const DICTATION_IDLE_MS = 60_000
export const ASK_IDLE_MS = 120_000
export const DICTATION_MAX_TOKENS = 8192
export const ASK_MAX_TOKENS = 16000
/** A brain dump's whole plan in one answer (4.8.1). */
export const BRAIN_DUMP_MAX_TOKENS = AI_LIMITS.brain_dump_max_tokens
/** One batch of a guided session's suggestions (9.1). */
export const ORGANIZE_MAX_TOKENS = AI_LIMITS.organize_max_tokens
const PROBE_MAX_TOKENS = 2048
/** One page read from an image (4.9.2). */
export const NOTES_READ_MAX_TOKENS = AI_LIMITS.notes_read_max_tokens

let transport: Transport = nodeTransport

/** Test hook: a fake transport. */
export function setAiTransport(next: Transport | null): void {
  transport = next ?? nodeTransport
}

export function toAiError(err: unknown): AiError {
  if (err instanceof AiFailure) return { kind: err.kind, message: err.message, ...(err.status ? { status: err.status } : {}) }
  return { kind: 'network', message: err instanceof Error ? err.message : 'The request failed.' }
}

function connectionOf(settings: AiSettings): ProviderConnection {
  const preset = settings.provider ? providerPreset(settings.provider) : undefined
  if (!preset || !isSetUp(settings, getProviderKey() !== null)) throw new AiFailure('not_set_up', 'Set up a provider in Settings, Assistant first.')
  if (!hasConsent(settings)) throw new AiFailure('no_consent', 'Agree to what the assistant sends in Settings, Assistant first.')
  return providerConnection(preset, settings.address, getProviderKey())
}

function refusedFor(settings: AiSettings, model: string): string[] {
  return settings.refusedFields[modelKey(settings, model)] ?? []
}

function rememberRefused(model: string) {
  return (field: string) => {
    void updateAiSettings((current) => {
      const key = modelKey(current, model)
      const fields = new Set(current.refusedFields[key] ?? [])
      fields.add(field)
      return { ...current, refusedFields: { ...current.refusedFields, [key]: [...fields] } }
    })
  }
}

async function wrap<T>(run: () => Promise<T>): Promise<AiResult<T>> {
  try {
    return { success: true, data: await run() }
  } catch (err) {
    return { success: false, error: toAiError(err) }
  }
}

/** A 404 or 405 from a typed address without a version path points at what is likely missing (2.4). */
function lacksVersionPath(settings: AiSettings, err: unknown): boolean {
  const preset = settings.provider ? providerPreset(settings.provider) : undefined
  return !!preset?.addressEditable && err instanceof AiFailure && err.status !== undefined &&
    ADDRESS_HINT_STATUSES.includes(err.status) && mayLackVersionPath(effectiveAddress(settings))
}

export function aiListModels(): Promise<AiResult<string[]>> {
  return wrap(async () => {
    const settings = getAiSettings()
    try {
      return await listModels(connectionOf(settings), transport)
    } catch (err) {
      if (err instanceof AiFailure && lacksVersionPath(settings, err)) throw new AiFailure(err.kind, `${err.message} ${AI_MESSAGES.addressVersionHint}`, err.status)
      throw err
    }
  })
}

function sameValues(actual: unknown, expected: Record<string, unknown>): boolean {
  if (typeof actual !== 'object' || actual === null) return false
  const object = actual as Record<string, unknown>
  return Object.entries(expected).every(([key, value]) => object[key] === value)
}

/**
 * Test connection (2.4) on one model: the model list, one structured answer (json_schema first,
 * then prompt; the one that works is kept for the model) and one tool call.
 */
export function aiTestConnection(model: string): Promise<AiResult<ConnectionTestResult>> {
  return wrap(async () => {
    const settings = getAiSettings()
    const connection = connectionOf(settings)
    const name = model.trim()
    if (!name) throw new AiFailure('bad_request', 'Choose a model first.')
    const result: ConnectionTestResult = {
      models: { ok: false, count: 0 },
      structured: { ok: false, mode: null },
      tool: { ok: false },
      features: { dictation: false, ask: false, talk: false },
    }
    let hint = false
    try {
      const models = await listModels(connection, transport)
      result.models = { ok: true, count: models.length }
    } catch (err) {
      result.models = { ok: false, count: 0, error: toAiError(err).message }
      hint ||= lacksVersionPath(settings, err)
    }

    const preset = providerPreset(settings.provider ?? '')
    const modes: StructuredMode[] = preset?.structured === 'prompt' ? ['prompt'] : ['json_schema', 'prompt']
    for (const mode of modes) {
      try {
        const answer = await structuredAnswer(connection, {
          model: name,
          system: '',
          user: PROBE.structured.user,
          schema: PROBE.structured.schema,
          mode,
          maxTokens: PROBE_MAX_TOKENS,
        }, { transport, idleTimeoutMs: DICTATION_IDLE_MS, refused: refusedFor(settings, name), onRefused: rememberRefused(name) })
        if (sameValues(answer, PROBE.structured.expect)) {
          result.structured = { ok: true, mode }
          break
        }
        result.structured = { ok: false, mode: null, error: `The answer was ${JSON.stringify(answer)}.` }
      } catch (err) {
        result.structured = { ok: false, mode: null, error: toAiError(err).message }
        hint ||= lacksVersionPath(settings, err)
        if (err instanceof AiFailure && (err.kind === 'auth' || err.kind === 'network' || err.kind === 'not_found')) break
      }
    }

    try {
      const tool: ToolSpec = PROBE.tool.tool
      const { message } = await runChat(connection, {
        model: name,
        system: '',
        messages: [{ role: 'user', text: PROBE.tool.user }],
        tools: [tool],
        deterministic: false,
        maxTokens: PROBE_MAX_TOKENS,
      }, { transport, idleTimeoutMs: ASK_IDLE_MS, refused: refusedFor(settings, name) })
      const call = message.toolCalls.find((c) => c.name === tool.name)
      let args: unknown = null
      try {
        args = call ? extractJsonObject(call.arguments || '{}') : null
      } catch {
        args = null
      }
      if (call && sameValues(args, PROBE.tool.expectArguments)) result.tool = { ok: true }
      else result.tool = { ok: false, error: call ? 'The model called the tool with other numbers.' : 'The model did not call the tool.' }
    } catch (err) {
      result.tool = { ok: false, error: toAiError(err).message }
      hint ||= lacksVersionPath(settings, err)
    }
    // Reading images (2.4): never needed to switch a feature on.
    if (result.structured.ok) result.vision = await visionProbe(connection, settings, name, result.structured.mode ?? 'json_schema')
    if (hint) result.hint = AI_MESSAGES.addressVersionHint

    result.features = {
      dictation: result.structured.ok,
      ask: result.structured.ok && result.tool.ok,
      talk: result.structured.ok && result.tool.ok,
    }
    await updateAiSettings((current) => ({
      ...current,
      tested: {
        ...current.tested,
        [modelKey(current, name)]: { structured: result.structured.mode, tools: result.tool.ok, ...(result.vision ? { vision: result.vision.ok } : {}) },
      },
    }))
    return result
  })
}

/** The word of the image probe, compared ignoring case and spaces at either end (2.4). */
function sameWord(actual: unknown, expected: string): boolean {
  return typeof actual === 'string' && actual.trim().toLowerCase() === expected.trim().toLowerCase()
}

/** Whether the model reads the probe image (2.4), in its structured mode. */
async function visionProbe(connection: ProviderConnection, settings: AiSettings, model: string, mode: StructuredMode): Promise<{ ok: boolean; error?: string }> {
  try {
    const answer = await structuredAnswer(connection, {
      model,
      system: '',
      user: PROBE.vision.user,
      images: [PROBE.vision.image],
      schema: PROBE.vision.schema,
      mode,
      maxTokens: PROBE_MAX_TOKENS,
    }, { transport, idleTimeoutMs: ASK_IDLE_MS, refused: refusedFor(settings, model), onRefused: rememberRefused(model) }) as { word?: unknown; number?: unknown }
    if (sameWord(answer.word, PROBE.vision.expect.word) && answer.number === PROBE.vision.expect.number) return { ok: true }
    return { ok: false, error: `The answer was ${JSON.stringify(answer)}.` }
  } catch (err) {
    return { ok: false, error: toAiError(err).message }
  }
}

/**
 * Asks a model whether it reads images (2.4), for a model tested before that check (4.9.1), and
 * keeps the result. A model without a structured result is tested whole first.
 */
export function aiTestVision(model: string): Promise<AiResult<{ ok: boolean; error?: string }>> {
  return wrap(async () => {
    const settings = getAiSettings()
    const connection = connectionOf(settings)
    const name = model.trim()
    if (!name) throw new AiFailure('bad_request', 'Choose a model first.')
    const caps = capabilitiesOf(settings, name)
    if (!caps?.structured) {
      const tested = await aiTestConnection(name)
      if (!tested.success) throw new AiFailure(tested.error.kind, tested.error.message, tested.error.status)
      return tested.data.vision ?? { ok: false, error: tested.data.structured.error ?? 'The model gave no structured answer.' }
    }
    const vision = await visionProbe(connection, settings, name, caps.structured)
    await updateAiSettings((current) => {
      const key = modelKey(current, name)
      const known = current.tested[key]
      return known ? { ...current, tested: { ...current.tested, [key]: { ...known, vision: vision.ok } } } : current
    })
    return vision
  })
}

/**
 * A structured answer, checked against the schema and repaired once: from the dictation model, or
 * from Ask's model for a guided session's suggestions (9.1).
 */
function structuredModelAnswer(
  request: { system: string; user: string; schema: JsonSchema; maxTokens: number; feature?: 'dictation' | 'ask' },
  signal?: AbortSignal,
): Promise<AiResult<unknown>> {
  return wrap(async () => {
    const settings = getAiSettings()
    const connection = connectionOf(settings)
    const feature = request.feature ?? 'dictation'
    const model = settings.models[feature]
    if (!model) throw new AiFailure('not_set_up', `Choose ${feature === 'ask' ? 'an Ask' : 'a dictation'} model in Settings, Assistant.`)
    const mode = capabilitiesOf(settings, model)?.structured ?? providerPreset(settings.provider ?? '')?.structured ?? 'json_schema'
    return structuredAnswer(connection, {
      model,
      system: request.system,
      user: request.user,
      schema: request.schema,
      mode,
      maxTokens: request.maxTokens,
    }, { transport, idleTimeoutMs: DICTATION_IDLE_MS, signal, refused: refusedFor(settings, model), onRefused: rememberRefused(model) })
  })
}

/** One dictation request (4.1, 4.4). */
export function aiDictate(input: { edit: boolean; user: string }, signal?: AbortSignal): Promise<AiResult<unknown>> {
  return structuredModelAnswer({
    system: dictationSystemPrompt(input.edit),
    user: input.user,
    schema: DICTATION_ANSWER_SCHEMA,
    maxTokens: DICTATION_MAX_TOKENS,
  }, signal)
}

/** One batch of notes (4.9.4) or its Update (4.9.8), with the dictation model. */
export function aiNotes(input: { edit: boolean; user: string }, signal?: AbortSignal): Promise<AiResult<unknown>> {
  return structuredModelAnswer({
    system: notesSystemPrompt(input.edit),
    user: input.user,
    schema: NOTES_ANSWER_SCHEMA,
    maxTokens: BRAIN_DUMP_MAX_TOKENS,
  }, signal)
}

/**
 * Reads one page image as text (4.9.2): the `notesRead` prompt on the reading model (4.9.1),
 * deterministic, plain text back. Needs the agreement for images (7.1).
 */
export function aiReadPage(input: { image: ChatImage; page: number; pages: number; title: string }, signal?: AbortSignal): Promise<AiResult<{ text: string; model: string }>> {
  return wrap(async () => {
    const settings = getAiSettings()
    const connection = connectionOf(settings)
    if (!hasImagesConsent(settings)) throw new AiFailure('no_consent', 'Agree to sending images of pages first.')
    const { model } = readingModel(settings)
    if (!model) throw new AiFailure('not_set_up', 'No model that reads images is set up. Choose one in Settings, Assistant.')
    const { message } = await runChat(connection, {
      model,
      system: promptText('notesRead'),
      messages: [{ role: 'user', text: readPageUserText(input.page, input.pages, input.title), images: [input.image] }],
      tools: [],
      deterministic: true,
      maxTokens: NOTES_READ_MAX_TOKENS,
    }, { transport, idleTimeoutMs: ASK_IDLE_MS, signal, refused: refusedFor(settings, model), onRefused: rememberRefused(model) })
    return { text: readPageAnswer(message.text), model }
  })
}

/** One brain dump request: Organize (4.8.1) or Update (4.8.4), with the dictation model. */
export function aiBrainDump(input: { edit: boolean; user: string }, signal?: AbortSignal): Promise<AiResult<unknown>> {
  return structuredModelAnswer({
    system: brainDumpSystemPrompt(input.edit),
    user: input.user,
    schema: BRAIN_DUMP_ANSWER_SCHEMA,
    maxTokens: BRAIN_DUMP_MAX_TOKENS,
  }, signal)
}

/**
 * One batch of suggestions for a guided session (section 9): the `organize` prompt, asked like a
 * dictation (deterministic, structured, dictation's idle timeout) of Ask's model, under Ask's
 * agreement.
 */
export function aiOrganize(input: { user: string }, signal?: AbortSignal): Promise<AiResult<unknown>> {
  return structuredModelAnswer({
    system: promptText('organize'),
    user: input.user,
    schema: ORGANIZE_ANSWER_SCHEMA,
    maxTokens: ORGANIZE_MAX_TOKENS,
    feature: 'ask',
  }, signal)
}

/**
 * Pro (section 11): converting pasted text to an import (11.1) and promise drafts in a meeting
 * (11.2), on Ask's model under Ask's agreement, deterministic. The caller checks Pro's assistant
 * switch first.
 */
export function aiProImport(input: { user: string }, signal?: AbortSignal): Promise<AiResult<unknown>> {
  return structuredModelAnswer({
    system: PRO_AI.proImport.prompt.lines.join('\n').replace('{items_max}', String(PRO_AI.limits.import_items_max)),
    user: input.user,
    schema: PRO_AI.proImport.answerSchema,
    maxTokens: PRO_AI.limits.import_max_tokens,
    feature: 'ask',
  }, signal)
}

export function aiPromiseDrafts(input: { user: string }, signal?: AbortSignal): Promise<AiResult<unknown>> {
  return structuredModelAnswer({
    system: PRO_AI.promiseDrafts.prompt.lines.join('\n'),
    user: input.user,
    schema: PRO_AI.promiseDrafts.answerSchema,
    maxTokens: DICTATION_MAX_TOKENS,
    feature: 'ask',
  }, signal)
}

/** Plan my day's suggestions (10.1): Ask's model and agreement, like a guided session's. */
export function aiPlanDay(input: { user: string }, signal?: AbortSignal): Promise<AiResult<unknown>> {
  return structuredModelAnswer({
    system: promptText('planDay'),
    user: input.user,
    schema: PLAN_DAY_ANSWER_SCHEMA,
    maxTokens: AI_LIMITS.plan_day_max_tokens,
    feature: 'ask',
  }, signal)
}

const askTurns = new Map<string, AbortController>()

/** One Ask round (5.1): streams the text, ends with the whole assistant message (tool calls included). */
export async function aiAskTurn(request: AskTurnRequest, emit: (event: AskTurnEvent) => void, options: { proTools?: boolean } = {}): Promise<void> {
  const controller = new AbortController()
  askTurns.set(request.turnId, controller)
  try {
    const settings = getAiSettings()
    const connection = connectionOf(settings)
    const model = settings.models.ask
    if (!model) throw new AiFailure('not_set_up', 'Choose an Ask model in Settings, Assistant.')
    // Pro's read tools only while Pro's assistant switch is on (11.3); the caller reads the switch.
    const offered = options.proTools ? [...enabledAskTools(), ...PRO_AI.askTools.filter((tool) => tool.enabled)] : enabledAskTools()
    const tools: ToolSpec[] = offered.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))
    // The last round leaves the tools out (5.5); the Messages API needs them defined while the
    // history holds tool blocks, so there they stay with tool_choice none.
    const anthropic = connection.protocol === 'anthropic-messages'
    const { message, stopReason } = await runChat(connection, {
      model,
      system: askSystemPrompt(request.talk),
      messages: request.messages,
      tools: request.final && !anthropic ? [] : tools,
      toolsOff: request.final && anthropic,
      deterministic: false,
      maxTokens: ASK_MAX_TOKENS,
    }, {
      transport,
      idleTimeoutMs: ASK_IDLE_MS,
      signal: controller.signal,
      refused: refusedFor(settings, model),
      onRefused: rememberRefused(model),
      onText: (text) => emit({ type: 'text', text }),
    })
    emit({ type: 'done', message, stopReason })
  } catch (err) {
    emit({ type: 'error', error: toAiError(err) })
  } finally {
    askTurns.delete(request.turnId)
  }
}

export function cancelAskTurn(turnId: string): boolean {
  const controller = askTurns.get(turnId)
  if (!controller) return false
  controller.abort()
  return true
}

export function cancelAllAskTurns(): void {
  for (const controller of askTurns.values()) controller.abort()
  askTurns.clear()
}
