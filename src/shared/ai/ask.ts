/**
 * Ask's conversation rules (docs/ai-assistant-v1.md section 5): the `<context>` block of the first
 * message and its refresh, the window of messages a request sends, the `[task:<id>]` marks, and
 * the tool-round limit. Pure.
 */
import { AI_LIMITS } from './contract'
import { weekdayName } from './dictation'
import { getWeekStart } from '../week-start'
import type { ChatMessage, StoredConversation } from './types'

export interface AskListContext {
  name: string
  projectId?: number
  customListId?: string
}

function minute(localDateTime: string): string {
  return localDateTime.slice(0, 16)
}

/** The first message's context JSON (5.1): now, weekday, time_zone, week_starts, list, the list's id, overview. */
export function askContextJson(now: string, timeZone: string, list: AskListContext, overview: unknown): string {
  const context: Record<string, unknown> = {
    now: minute(now),
    weekday: weekdayName(now.slice(0, 10)),
    time_zone: timeZone,
    week_starts: getWeekStart(),
    list: list.name,
  }
  if (list.projectId !== undefined) context.list_project_id = list.projectId
  else if (list.customListId !== undefined) context.list_custom_list_id = list.customListId
  context.overview = overview
  return JSON.stringify(context)
}

/** A later message's refresh block: only `now` and `weekday`. */
export function askRefreshJson(now: string): string {
  return JSON.stringify({ now: minute(now), weekday: weekdayName(now.slice(0, 10)) })
}

/** Whether a message at `now` gets a refresh block: another local day, or more than 30 minutes after the previous one. */
export function needsContextRefresh(previous: string, now: string): boolean {
  if (previous.slice(0, 10) !== now.slice(0, 10)) return true
  const toMinutes = (value: string) => {
    const [h, m] = value.slice(11, 16).split(':').map(Number)
    return h * 60 + m
  }
  return toMinutes(now) - toMinutes(previous) > AI_LIMITS.context_refresh_minutes
}

/** When a conversation was last used: its last message, else its last change (ms since the epoch). */
export function lastActivity(conversation: Pick<StoredConversation, 'updatedAt' | 'messages'>): number {
  return conversation.messages[conversation.messages.length - 1]?.at ?? conversation.updatedAt
}

/**
 * Ask opens on a new, empty conversation when the last one has been idle for more than
 * `context_refresh_minutes`; the old one stays in the history.
 */
export function isStaleConversation(conversation: Pick<StoredConversation, 'updatedAt' | 'messages'>, nowMs: number): boolean {
  return nowMs - lastActivity(conversation) > AI_LIMITS.context_refresh_minutes * 60_000
}

export function withContext(contextJson: string, text: string): string {
  return `<context>\n${contextJson}\n</context>\n${text}`
}

/**
 * The messages a request sends (5.1): at most the last 40, starting with a user message, so a tool
 * result is never sent without its call (and every provider gets a user turn first).
 */
export function requestWindow(messages: readonly ChatMessage[], max = AI_LIMITS.request_max_messages): ChatMessage[] {
  let start = Math.max(0, messages.length - max)
  while (start < messages.length && messages[start].role !== 'user') start++
  return messages.slice(start)
}

const TASK_MARK = /\[task:(\d+)\]/g

export type AnswerPart = { text: string } | { taskId: number }

/**
 * A model's text split into text and task marks. A mark whose id a tool returned in this
 * conversation becomes a task row; any other renders as nothing (5.1).
 */
export function answerParts(text: string, knownTaskIds: ReadonlySet<number>): AnswerPart[] {
  const parts: AnswerPart[] = []
  let last = 0
  for (const match of text.matchAll(TASK_MARK)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ text: text.slice(last, index) })
    const id = Number(match[1])
    if (knownTaskIds.has(id)) parts.push({ taskId: id })
    last = index + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  // Text left around removed marks: drop what is only whitespace between rows.
  return parts.filter((part) => !('text' in part) || part.text.trim() !== '' || parts.length === 1)
}

/** Text for the system voice: no task marks, no markdown emphasis. */
export function spokenText(text: string): string {
  return text.replace(TASK_MARK, '').replace(/[*_`#]+/g, '').replace(/\s+/g, ' ').trim()
}
