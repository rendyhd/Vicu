import { create } from 'zustand'
import { AI_LIMITS, AI_MESSAGES, askTool } from '../../shared/ai/contract'
import { firstSchemaProblem, extractJsonObject } from '../../shared/ai/schema'
import { askContextJson, askRefreshJson, isStaleConversation, needsContextRefresh, requestWindow, spokenText, withContext } from '../../shared/ai/ask'
import { localDateTimeOf } from '../../shared/ai/dictation'
import type { AiError, AskTurnEvent, ChatMessage, StoredConversation, ToolCall, ToolResult } from '../../shared/ai/types'
import { runReadTool, taskIdsIn, ToolError, toolErrorResult, getOverview, type ToolContext } from '@/lib/ai/ask-tools'
import { buildProposal, DECLINED, applyProposal, proposalSize, type ApplyDeps, type Proposal, type ProposalResult } from '@/lib/ai/proposals'
import { timeZone, type ListInfo } from '@/lib/ai/workspace'
import { readSaid } from '@/lib/ai/said-parser'
import { confirmDelete } from '@/lib/confirm-bridge'
import { cancelOpenMic, openMicOwner, setOpenMicInterruptible, startOpenMic, type OpenMicClient } from '@/lib/ai/open-mic'
import { stopSpeaking } from '@/lib/ai/speech-output'
import { spokenConfirmation } from '../../shared/ai/talk'
import { announce } from '@/stores/announcer-store'
import { UNDO_TOAST_MS, toast, useToastStore } from '@/stores/toast-store'
import { useVoiceStore } from '@/stores/voice-store'

// Ask (docs/ai-assistant-v1.md section 5): one conversation at a time with the user's model, which
// looks things up through the read tools and proposes changes as cards. The provider request runs
// in main (ai:ask-start, streamed back as ai:ask-event); the tools, the cards and the writes run
// here. Conversations stay on this device (the last 5, 100 messages each); requests send the last
// 40 messages. Talk (section 6) is the same conversation with the talk prompt, spoken, through the
// open microphone (3.7): talking again while an answer runs interrupts it (`interrupt`).

export interface PendingProposal {
  callId: string
  proposal: Proposal
  /** The answer the tool call is waiting for. */
  resolve: (result: ProposalResult) => void
  /** Set when the user wrote on while the card was open (6.1): it stays and can still be applied. */
  superseded?: boolean
}

export interface AskDeps {
  tools: () => ToolContext
  apply: () => ApplyDeps
  list: () => ListInfo
  defaultProjectId: () => number
  speak: (text: string) => void
}

let deps: AskDeps | null = null
export function setAskDeps(next: AskDeps | null): void {
  deps = next
}

interface AskState {
  open: boolean
  loaded: boolean
  conversations: StoredConversation[]
  currentId: string | null
  busy: boolean
  /** The answer being streamed. */
  streaming: string
  /** What the assistant is doing ("Looking up tasks"). */
  status: string | null
  pending: PendingProposal | null
  /** A card the user may still apply after writing on (6.1). */
  lingering: PendingProposal | null
  error: string | null
  /** Talk: answers are spoken; the talk prompt is added. */
  talk: boolean
  /** A card of the message being answered was applied or declined: talking no longer interrupts it. */
  decided: boolean
  load: () => Promise<void>
  setOpen: (open: boolean) => void
  newChat: () => void
  select: (id: string) => void
  setTalk: (talk: boolean) => void
  send: (text: string) => Promise<void>
  cancel: () => void
  /**
   * The person talked again while the answer runs (3.7): it stops and the conversation goes back to
   * before the message, which the open microphone sends again with the new words. Not while a card
   * waits or after one was decided.
   */
  interrupt: () => void
  decide: (apply: boolean, which?: 'pending' | 'lingering') => Promise<void>
  /** The user changed a date on the card: Apply reads the card as it is now. */
  editCard: (which: 'pending' | 'lingering', proposal: Proposal) => void
}

let turnCounter = 0
let cancelled = false
/** The user wrote on while a card was open: the round ends with its results, and the new message follows. */
let interrupted = false
/** Talking interrupted the answer: the send rolls the conversation back when it ends. */
let rollback = false
let activeTurn: string | null = null

const settled = async (busy: () => boolean) => {
  while (busy()) await new Promise((resolve) => setTimeout(resolve, 20))
}

function newConversation(talk: boolean): StoredConversation {
  const now = Date.now()
  return { id: `c-${now}-${Math.random().toString(36).slice(2, 8)}`, title: '', createdAt: now, updatedAt: now, talk, messages: [], taskIds: [] }
}

function errorText(error: AiError): string {
  switch (error.kind) {
    case 'timeout': return 'The model did not answer in time.'
    case 'network': return 'Could not reach the model.'
    case 'auth': return 'The provider refused the key.'
    case 'cancelled': return 'Stopped.'
    default: return error.message || 'The request failed.'
  }
}

/** One provider round, streamed. */
function streamTurn(messages: ChatMessage[], talk: boolean, final: boolean, onText: (text: string) => void): Promise<Extract<AskTurnEvent, { type: 'done' }>> {
  const turnId = `t-${Date.now()}-${++turnCounter}`
  activeTurn = turnId
  return new Promise((resolve, reject) => {
    const unsubscribe = window.api.ai.onAskEvent(({ turnId: id, event }) => {
      if (id !== turnId) return
      if (event.type === 'text') onText(event.text)
      else {
        unsubscribe()
        if (activeTurn === turnId) activeTurn = null
        if (event.type === 'done') resolve(event)
        else reject(event.error)
      }
    })
    void window.api.ai.askStart({ turnId, talk, messages, final }).then((started) => {
      if (!started) {
        unsubscribe()
        reject({ kind: 'bad_request', message: 'The request could not start.' } satisfies AiError)
      }
    })
  })
}

function parseArguments(call: ToolCall): { args: Record<string, unknown> } | { problem: string } {
  const tool = askTool(call.name)
  if (!tool || !tool.enabled) return { problem: `there is no tool ${call.name}` }
  let args: unknown
  try {
    args = call.arguments.trim() === '' ? {} : extractJsonObject(call.arguments)
  } catch (err) {
    return { problem: err instanceof Error ? err.message.replace(/^the answer/, 'the arguments') : 'the arguments are not JSON' }
  }
  const problem = firstSchemaProblem(args, tool.parameters)
  return problem ? { problem: problem.replace(/^the answer/, 'the arguments') } : { args: args as Record<string, unknown> }
}

export const useAskStore = create<AskState>((set, get) => {
  const current = (): StoredConversation | null => get().conversations.find((c) => c.id === get().currentId) ?? null

  const update = (conversation: StoredConversation) => {
    const others = get().conversations.filter((c) => c.id !== conversation.id)
    const next = [{ ...conversation, updatedAt: Date.now(), messages: conversation.messages.slice(-AI_LIMITS.conversation_max_messages) }, ...others]
      .slice(0, AI_LIMITS.conversations_kept)
    set({ conversations: next, currentId: conversation.id })
    void window.api.ai.saveConversations(next).catch(() => {})
  }

  const push = (message: ChatMessage, taskIds: number[] = []) => {
    const conversation = current() ?? newConversation(get().talk)
    const ids = new Set(conversation.taskIds)
    for (const id of taskIds) ids.add(id)
    update({ ...conversation, messages: [...conversation.messages, { at: Date.now(), message }], taskIds: [...ids] })
  }

  /** A tool call left without its result (stopped, closed) gets one, so the next request is valid. */
  const closeOpenCalls = (reason: string) => {
    const conversation = current()
    const last = conversation?.messages[conversation.messages.length - 1]?.message
    if (!last || last.role !== 'assistant' || last.toolCalls.length === 0) return
    push({ role: 'tool', results: last.toolCalls.map((call) => ({ callId: call.id, name: call.name, content: JSON.stringify(toolErrorResult('cancelled', reason)) })) })
  }

  async function runCall(call: ToolCall, ctx: ToolContext): Promise<{ result: ToolResult; taskIds: number[] }> {
    const parsed = parseArguments(call)
    if ('problem' in parsed) {
      return { result: { callId: call.id, name: call.name, content: JSON.stringify(toolErrorResult('invalid_arguments', parsed.problem)), isError: true }, taskIds: [] }
    }
    const tool = askTool(call.name)!
    try {
      if (tool.kind === 'read') {
        set({ status: 'Looking up tasks…' })
        const value = await runReadTool(call.name, parsed.args, ctx)
        return { result: { callId: call.id, name: call.name, content: JSON.stringify(value) }, taskIds: taskIdsIn(value) }
      }
      set({ status: null })
      const proposal = await buildProposal(call.name, parsed.args, {
        ws: ctx.ws,
        fetchTask: ctx.fetchTask,
        reference: localDateTimeOf(ctx.now()),
        readSaid: (said) => readSaid(said, localDateTimeOf(ctx.now()), navigator.language),
        defaultProjectId: deps?.defaultProjectId() ?? ctx.ws.inboxProjectId,
      })
      const taskIds = proposal.tool === 'propose_update_tasks' ? proposal.updates.map((u) => u.task.id)
        : proposal.tool === 'propose_complete_tasks' ? proposal.tasks.map((t) => t.id) : []
      // An older card the user could still apply closes when a new one comes.
      announce('A change is proposed. Apply or decline it.')
      const outcome = await new Promise<ProposalResult>((resolve) => {
        set({ pending: { callId: call.id, proposal, resolve }, lingering: null })
      })
      return { result: { callId: call.id, name: call.name, content: JSON.stringify(outcome) }, taskIds: [...taskIds, ...outcome.applied] }
    } catch (err) {
      const error = err instanceof ToolError ? toolErrorResult(err.code, err.detail) : toolErrorResult('not_found', err instanceof Error ? err.message : 'The lookup failed.')
      return { result: { callId: call.id, name: call.name, content: JSON.stringify(error), isError: err instanceof ToolError && err.code === 'invalid_arguments' }, taskIds: [] }
    }
  }

  return {
    open: false,
    loaded: false,
    conversations: [],
    currentId: null,
    busy: false,
    streaming: '',
    status: null,
    pending: null,
    lingering: null,
    error: null,
    talk: false,
    decided: false,

    load: async () => {
      if (get().loaded) return
      const conversations = await window.api.ai.getConversations().catch(() => [])
      set({ conversations, loaded: true, currentId: conversations[0]?.id ?? null, talk: conversations[0]?.talk ?? false })
    },

    setOpen: (open) => {
      set({ open })
      if (!open) {
        if (openMicOwner() === 'ask') cancelOpenMic()
        return
      }
      // A conversation left for longer than context_refresh_minutes is not picked up again: Ask
      // opens on a new one and the old one stays in the history. Never while it is answering.
      void get().load().then(() => {
        const conversation = current()
        if (get().open && !get().busy && conversation && isStaleConversation(conversation, Date.now())) {
          set({ currentId: null, error: null, streaming: '', status: null, lingering: null })
        }
      })
    },

    newChat: () => {
      if (get().busy) get().cancel()
      set({ currentId: null, error: null, streaming: '', status: null })
    },

    select: (id) => {
      if (get().busy) return
      const conversation = get().conversations.find((c) => c.id === id)
      set({ currentId: id, error: null, talk: conversation?.talk ?? get().talk })
    },

    setTalk: (talk) => {
      set({ talk })
      const conversation = current()
      if (conversation) update({ ...conversation, talk })
    },

    send: async (rawText) => {
      const text = rawText.trim()
      if (!text || !deps) return
      // Written on while a card is open (6.1): the card stays, the call is answered as declined.
      const open = get().pending
      if (open) {
        interrupted = true
        set({ pending: null, lingering: { ...open, superseded: true } })
        open.resolve(DECLINED(open.proposal))
      }
      // The round that waited for the card records its results and ends, an interrupted answer
      // rolls back, an answer that goes on after a decided card finishes; then this message goes.
      await settled(() => get().busy)
      if (get().busy || !deps) return
      cancelled = false
      interrupted = false
      rollback = false
      const ctx = deps.tools()
      const nowLocal = localDateTimeOf(ctx.now())
      const conversation = current()
      const talk = get().talk
      const conversationId = conversation?.id ?? null
      // Where an interruption rolls back to: before this message.
      const before = conversation?.messages.length ?? 0
      set({ busy: true, error: null, streaming: '', status: null, decided: false })
      try {
        let message = text
        const previous = conversation?.messages.filter((m) => m.message.role === 'user').at(-1)
        if (!conversation || conversation.messages.length === 0) {
          set({ status: 'Reading your lists…' })
          const overview = await getOverview(ctx)
          const list = deps.list()
          message = withContext(askContextJson(nowLocal, timeZone(), {
            name: list.name,
            ...(list.listProjectId !== undefined ? { projectId: list.listProjectId } : {}),
            ...(list.listCustomListId !== undefined ? { customListId: list.listCustomListId } : {}),
          }, overview), text)
          const fresh = conversation ?? newConversation(talk)
          update({ ...fresh, title: text.slice(0, 80), talk })
        } else if (previous && needsContextRefresh(localDateTimeOf(new Date(previous.at)), nowLocal)) {
          message = withContext(askRefreshJson(nowLocal), text)
        }
        push({ role: 'user', text: message })

        let rounds = 0
        for (;;) {
          if (cancelled) return
          const final = rounds >= AI_LIMITS.ask_tool_rounds_max
          if (final) push({ role: 'user', text: AI_MESSAGES.finalAnswer })
          const messages = requestWindow((current()?.messages ?? []).map((m) => m.message))
          set({ streaming: '', status: rounds === 0 ? 'Thinking…' : get().status })
          const done = await streamTurn(messages, talk, final, (piece) => set((s) => ({ streaming: s.streaming + piece, status: null })))
          if (cancelled) return
          const answer = done.message
          // The last round has no tools: a tool call it still makes is dropped, never left unanswered.
          const toolCalls = final ? [] : answer.toolCalls
          const kept = final && answer.toolCalls.length > 0
            ? { ...answer, toolCalls: [], raw: answer.raw?.filter((block) => (block as { type?: string })?.type !== 'tool_use') }
            : answer
          push(kept)
          set({ streaming: '' })
          if (toolCalls.length === 0) {
            if (talk && answer.text.trim()) deps?.speak(spokenText(answer.text))
            break
          }
          rounds++
          const results: ToolResult[] = []
          const ids: number[] = []
          for (const call of toolCalls) {
            const outcome = await runCall(call, ctx)
            results.push(outcome.result)
            ids.push(...outcome.taskIds)
          }
          push({ role: 'tool', results }, ids)
          if (interrupted) break
        }
      } catch (err) {
        const error = err as AiError
        closeOpenCalls('stopped')
        if (!rollback) set({ error: errorText(error && typeof error === 'object' && 'kind' in error ? error : { kind: 'network', message: String(err) }) })
      } finally {
        if (rollback) {
          rollback = false
          const after = current()
          if (after && (after.id === conversationId || conversationId === null)) update({ ...after, messages: after.messages.slice(0, before) })
        }
        set({ busy: false, status: null, streaming: '', decided: false })
      }
    },

    interrupt: () => {
      if (!get().busy || get().pending || get().decided) return
      rollback = true
      cancelled = true
      if (activeTurn) void window.api.ai.askCancel(activeTurn)
      set({ status: null, streaming: '' })
    },

    cancel: () => {
      cancelled = true
      if (activeTurn) void window.api.ai.askCancel(activeTurn)
      const pending = get().pending
      if (pending) pending.resolve(DECLINED(pending.proposal))
      set({ pending: null, status: null, streaming: '' })
    },

    editCard: (which, proposal) => {
      const card = get()[which]
      if (card) set({ [which]: { ...card, proposal } } as Pick<AskState, 'pending'> | Pick<AskState, 'lingering'>)
    },

    decide: async (apply, which = 'pending') => {
      const card = which === 'pending' ? get().pending : get().lingering
      if (!card || !deps) return
      if (which === 'pending') set({ decided: true })
      if (!apply) {
        set(which === 'pending' ? { pending: null } : { lingering: null })
        card.resolve(DECLINED(card.proposal))
        announce('Declined')
        return
      }
      const size = proposalSize(card.proposal)
      if (size > AI_LIMITS.proposal_confirm_twice_above) {
        const sure = await confirmDelete(`Apply this change to ${size} tasks?`, { force: true, confirmLabel: 'Apply', destructive: false })
        if (!sure) return
      }
      set(which === 'pending' ? { pending: null } : { lingering: null })
      const applied = await applyProposal(card.proposal, deps.apply())
      if (!card.superseded) card.resolve(applied.result)
      if (applied.count > 0) {
        const created = card.proposal.tool === 'propose_create_tasks'
        const message = created
          ? (applied.count === 1 ? 'Added 1 task' : `Added ${applied.count} tasks`)
          : (applied.count === 1 ? 'Changed 1 task' : `Changed ${applied.count} tasks`)
        useToastStore.getState().push('success', message, {
          durationMs: UNDO_TOAST_MS,
          action: { label: 'Undo', onAction: () => void applied.undo() },
        })
        if (created) {
          const conversation = current()
          if (conversation) update({ ...conversation, taskIds: [...new Set([...conversation.taskIds, ...applied.result.applied])] })
        }
      } else if (applied.result.status === 'failed' && size > 0) {
        // With nothing to apply the card already said why; only a change that was tried and failed is news.
        toast.error('The change could not be applied.')
      }
    },
  }
})

/**
 * Talk's turns (3.7, 6): with a card open, a spoken yes or no answers it (6.1); anything else is
 * the next message. Talking again while an answer runs interrupts it.
 */
const talkClient: OpenMicClient = {
  onTurn: async (text) => {
    const ask = useAskStore.getState()
    const card = ask.pending ?? ask.lingering
    if (card) {
      const answer = spokenConfirmation(text, navigator.language.slice(0, 2).toLowerCase())
      if (answer !== 'other') {
        await ask.decide(answer === 'yes', ask.pending ? 'pending' : 'lingering')
        return
      }
    }
    await ask.send(text)
  },
  onInterrupt: () => useAskStore.getState().interrupt(),
}

/** Ask's microphone on (Talk): answers are spoken, and the person just keeps talking. */
export function startTalk(): void {
  stopSpeaking()
  useVoiceStore.getState().cancel()
  const ask = useAskStore.getState()
  if (!ask.open) ask.setOpen(true)
  if (!ask.talk) ask.setTalk(true)
  startOpenMic('ask', talkClient)
  setOpenMicInterruptible(ask.pending === null && !ask.decided)
}
