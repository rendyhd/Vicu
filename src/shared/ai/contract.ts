/**
 * The AI assistant contract's machine-readable half (docs/ai-assistant-v1.md,
 * test-fixtures/ai-tools-v1.json), typed. The fixture is the one source of the prompts, schemas,
 * tools, presets, limits, speech settings and fixed messages: both the main process and the
 * windows import it from here, so the app sends exactly the fixture's text. Never copy a prompt or
 * a schema into code.
 *
 * Only the top-level blocks the app uses are imported (Vite turns the JSON's top-level keys into
 * named exports); the vectors are read by the tests straight from the file.
 */
import {
  contractVersion as fixtureContractVersion,
  schemaSubset as fixtureSchemaSubset,
  limits as fixtureLimits,
  protocols as fixtureProtocols,
  providers as fixtureProviders,
  probe as fixtureProbe,
  speech as fixtureSpeech,
  dictation as fixtureDictation,
  brainDump as fixtureBrainDump,
  organize as fixtureOrganize,
  ask as fixtureAsk,
  talk as fixtureTalk,
  prompts as fixturePrompts,
  messages as fixtureMessages,
} from '../../../test-fixtures/ai-tools-v1.json'

/** A JSON schema inside the subset every strict mode accepts (section 2.2). */
export type JsonSchema = {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchema
  enum?: unknown[]
  description?: string
  anyOf?: JsonSchema[]
}

export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'openwebui' | 'openrouter' | 'other'
export type WireProtocol = 'openai-chat' | 'anthropic-messages'
export type StructuredMode = 'json_schema' | 'prompt'
export type AiFeature = 'dictation' | 'ask'

export interface ProviderPreset {
  id: ProviderId
  name: string
  protocol: WireProtocol
  /** Null for `other`: the user types it. */
  address: string | null
  addressEditable: boolean
  key: 'required' | 'optional'
  auth: { header: string; prefix: string }
  headers: Record<string, string>
  structured: StructuredMode
  transcription: { kind: 'endpoint' | 'in_request'; path: string | null } | null
  suggested: { dictation: string | null; ask: string | null }
}

export interface SpeechModelInfo {
  id: string
  engine: 'whisper' | 'parakeet'
  label: string
  repo: string
  commit: string
  file: string
  size: number
  sha256: string
  language_count: number
  language_codes: string[] | null
  license: string
  attribution: string | null
  default_for: Array<'computer' | 'phone' | 'phone_low_memory'>
}

export interface VadSettings {
  model: { id: string; repo: string; commit: string; file: string; size: number; sha256: string; license: string; bundled: boolean }
  threshold: number
  min_speech_ms: number
  min_silence_ms: number
  pad_ms: number
  max_phrase_s: number
}

/** The open microphone's turns (3.7). */
export interface TurnSettings {
  end_of_turn_ms: number
  idle_s: number
  /** A brain dump's microphone turns off after this long without speech instead (4.8). */
  dump_idle_s: number
}

export interface AskTool {
  name: string
  kind: 'read' | 'proposal'
  enabled: boolean
  description: string
  parameters: JsonSchema
}

export interface Prompt {
  version: number
  lines: string[]
}

export const AI_CONTRACT_VERSION: number = fixtureContractVersion
export const SCHEMA_SUBSET = fixtureSchemaSubset as unknown as { keywords: string[]; types: string[]; rules: string[] }
export const AI_LIMITS = fixtureLimits as unknown as Readonly<{
  audio_max_seconds: number
  transcript_max_chars: number
  drafts_max: number
  title_max_chars: number
  notes_max_chars: number
  labels_max: number
  subtasks_max: number
  subtask_title_max_chars: number
  repeat_every_max: number
  reminder_before_due_max_minutes: number
  model_date_max_years: number
  repair_attempts: number
  connect_timeout_s: number
  dictation_idle_timeout_s: number
  ask_idle_timeout_s: number
  ask_tool_rounds_max: number
  find_tasks_default_limit: number
  find_tasks_max_limit: number
  list_view_page_size: number
  get_task_notes_max_chars: number
  proposal_max_tasks: number
  proposal_confirm_twice_above: number
  conversations_kept: number
  conversation_max_messages: number
  request_max_messages: number
  context_refresh_minutes: number
  brain_dump_projects_max: number
  brain_dump_tasks_max: number
  brain_dump_max_tokens: number
  organize_batch_max: number
  organize_prefetch: number
  organize_notes_max_chars: number
  organize_reason_max_chars: number
  organize_max_tokens: number
  saved_addresses_max: number
}>
export const PROTOCOLS = fixtureProtocols as unknown as Record<WireProtocol, { chat: string; models: string }>
export const PROVIDER_PRESETS = fixtureProviders as unknown as ProviderPreset[]
export const PROBE = fixtureProbe as unknown as {
  structured: { user: string; schema: JsonSchema; expect: Record<string, unknown> }
  tool: { user: string; tool: { name: string; description: string; parameters: JsonSchema }; expectArguments: Record<string, unknown> }
}
export const SPEECH = fixtureSpeech as unknown as {
  audio: { sample_rate_hz: number; channels: number; bits: number; max_seconds: number }
  vad: VadSettings
  turn: TurnSettings
  decode: {
    temperature: number
    temperature_fallback: boolean
    condition_on_previous_text: boolean
    suppress_non_speech: boolean
    max_threads: number
    language: string
  }
  hint: { max_chars: number; max_name_chars: number; separator: string; end: string }
  models: SpeechModelInfo[]
}
export const DICTATION_CONTEXT_KEYS = fixtureDictation.contextKeys as unknown as string[]
export const DICTATION_ANSWER_SCHEMA = fixtureDictation.answerSchema as unknown as JsonSchema
/** The draft fields in their order (`guessed` and `unsure` use these names). */
export const DICTATION_FIELDS = fixtureDictation.fields as unknown as DraftField[]
export const BRAIN_DUMP_ANSWER_SCHEMA = fixtureBrainDump.answerSchema as unknown as JsonSchema
/** The answer of a guided session's suggestions (section 9.2). */
export const ORGANIZE_ANSWER_SCHEMA = fixtureOrganize.answerSchema as unknown as JsonSchema
export const ASK_TASK_SUMMARY_SCHEMA = fixtureAsk.taskSummary as unknown as JsonSchema
export const ASK_TOOLS = fixtureAsk.tools as unknown as AskTool[]
export const PROPOSAL_STATUSES = fixtureAsk.proposalResult.status as unknown as Array<'applied' | 'declined' | 'partly_applied' | 'failed'>
export const SKIP_REASONS = fixtureAsk.proposalResult.skipReasons as unknown as Array<'not_found' | 'read_only' | 'invalid'>
export const TASK_MARK = fixtureAsk.taskMark as unknown as string
/** The kinds of list Ask's starters are given for (5.7). */
export type StarterKind = 'today' | 'upcoming' | 'inbox' | 'project' | 'other'
/** Ask's starters by the kind of list it was opened from (5.7); one is sent exactly as written. */
export const ASK_STARTERS = fixtureAsk.starters as unknown as Record<StarterKind, string[]>
export const TALK_CONFIRM = fixtureTalk.confirm as unknown as Record<string, { yes: string[]; no: string[] }>
export const PROMPTS = fixturePrompts as unknown as Record<'dictation' | 'dictationEdit' | 'brainDump' | 'brainDumpEdit' | 'ask' | 'talk' | 'organize', Prompt>
export const AI_MESSAGES = fixtureMessages as unknown as {
  promptSchemaIntro: string
  repair: string
  finalAnswer: string
  addressHelp: string
  addressVersionHint: string
}

export type DraftField = 'title' | 'notes' | 'when' | 'project' | 'labels' | 'priority' | 'repeat' | 'reminder' | 'place' | 'subtasks'

export function providerPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id)
}

/** The tools Ask offers (`propose_delete_tasks` is `enabled: false` in v1). */
export function enabledAskTools(): AskTool[] {
  return ASK_TOOLS.filter((tool) => tool.enabled)
}

export function askTool(name: string): AskTool | undefined {
  return ASK_TOOLS.find((tool) => tool.name === name)
}

/** Prompts are stored as lines; apps join them with `\n` and send the text exactly (section 8). */
export function promptText(name: keyof typeof PROMPTS): string {
  return PROMPTS[name].lines.join('\n')
}

/** System text of a dictation request; an edit appends the `dictationEdit` prompt after a blank line (4.4). */
export function dictationSystemPrompt(edit: boolean): string {
  return edit ? `${promptText('dictation')}\n\n${promptText('dictationEdit')}` : promptText('dictation')
}

/**
 * System text of a brain dump (4.8.1): the `dictation` prompt, a blank line and the `brainDump`
 * prompt; an Update (4.8.4) appends the `brainDumpEdit` prompt after another blank line.
 */
export function brainDumpSystemPrompt(edit: boolean): string {
  const organize = `${promptText('dictation')}\n\n${promptText('brainDump')}`
  return edit ? `${organize}\n\n${promptText('brainDumpEdit')}` : organize
}

/** System text of an Ask conversation; Talk adds the `talk` prompt after a blank line (5.1). */
export function askSystemPrompt(talk: boolean): string {
  return talk ? `${promptText('ask')}\n\n${promptText('talk')}` : promptText('ask')
}

/**
 * Prompt mode (2.2): the schema at the end of the system prompt, after the line `Answer with JSON
 * that matches this schema:`, as compact JSON in the fixture's key order.
 */
export function promptModeSystem(system: string, schema: JsonSchema): string {
  return `${system}\n\n${AI_MESSAGES.promptSchemaIntro}\n${JSON.stringify(schema)}`
}

/** The repair request's user message (2.2). */
export function repairMessage(problem: string): string {
  return AI_MESSAGES.repair.replace('{problem}', problem)
}

/** The speech model the desktop suggests (`default_for: computer`). */
export function suggestedComputerModel(): SpeechModelInfo | undefined {
  return SPEECH.models.find((model) => model.default_for.includes('computer'))
}

export function speechModel(id: string): SpeechModelInfo | undefined {
  return SPEECH.models.find((model) => model.id === id)
}

/** `https://huggingface.co/<repo>/resolve/<commit>/<file>` (3.5). */
export function speechModelUrl(model: Pick<SpeechModelInfo, 'repo' | 'commit' | 'file'>): string {
  return `https://huggingface.co/${model.repo}/resolve/${model.commit}/${model.file}`
}
