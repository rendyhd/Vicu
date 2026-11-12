import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import { Loader2, Mic, MessageSquarePlus, Send, Sparkles, Square, Volume2, VolumeX, X } from 'lucide-react'
import { Button } from '@/components/shared/Button'
import { AskAgenda } from './AskAgenda'
import { Checkbox } from '@/components/shared/Checkbox'
import { cn } from '@/lib/cn'
import { api } from '@/lib/api'
import { useAiReady, useAiSettings, useAiWorkspace, useSaveAiSettings } from '@/hooks/use-ai'
import { useAddDrafts } from '@/hooks/use-add-drafts'
import { useAppConfig } from '@/hooks/use-app-config'
import { useDateFormat } from '@/hooks/use-date-format'
import { useOpenTask } from '@/hooks/use-open-task'
import { useSyncedPrefs } from '@/hooks/use-synced-prefs'
import { useProToolData } from '@/hooks/use-pro-assistant'
import {
  useAddLabel,
  useCompleteTask,
  useCreateLabel,
  useDeleteTask,
  useRemoveLabel,
  useUncompleteTask,
  useUpdateTask,
} from '@/hooks/use-task-mutations'
import { openMicHearing, openMicOwner, setOpenMicInterruptible, stopOpenMic, useOpenMicStore } from '@/lib/ai/open-mic'
import { speakAnswer, stopSpeaking } from '@/lib/ai/speech-output'
import { defaultProjectFor, listInfoOf, pathOf } from '@/lib/ai/workspace'
import { proposalSize, withEditedDue } from '@/lib/ai/proposals'
import { formatDateChip } from '@/lib/date-utils'
import { isDateOnly, isNoDueDate, toLocalDate } from '@/lib/due-dates'
import { startTalk, useAskStore, setAskDeps, type PendingProposal } from '@/stores/ask-store'
import { useUIStore } from '@/stores/ui-store'
import { useVoiceListStore } from '@/stores/voice-list-store'
import { answerParts } from '../../../shared/ai/ask'
import { dueForApi, instantOfLocal, localDateTimeOf } from '../../../shared/ai/dictation'
import { NULL_DATE } from '@/lib/constants'
import { WhenPopover } from '@/components/task-list/WhenPopover'
import type { ChatMessage } from '../../../shared/ai/types'
import type { Task } from '@/lib/vikunja-types'

/** The user's own words of a stored message (the context block is for the model). */
function userWords(text: string): string {
  return text.replace(/^<context>\n[\s\S]*?\n<\/context>\n/, '')
}

/**
 * Ask and Talk (docs/ai-assistant-v1.md sections 5 and 6). Always mounted in AppShell, so a
 * conversation keeps running while the pane is closed; the pane opens from the Ask button next to
 * Search, the command palette, or Mod+J. The tools and the writes are wired here, where the
 * window's caches and mutations are. Talk is the microphone button: an open microphone (3.7).
 */
export function AskHost() {
  const ready = useAiReady()
  const ws = useAiWorkspace()
  const { data: config } = useAppConfig()
  const { data: aiSettings } = useAiSettings()
  const { snapshot } = useSyncedPrefs()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const addDrafts = useAddDrafts()
  const deleteTask = useDeleteTask()
  const updateTask = useUpdateTask()
  const createLabel = useCreateLabel({ silent: true })
  const addLabel = useAddLabel()
  const removeLabel = useRemoveLabel()
  const complete = useCompleteTask()
  const reopen = useUncompleteTask()
  const open = useAskStore((s) => s.open)

  const proData = useProToolData()
  const live = useRef({ ws, config, snapshot, pathname, aiSettings, proData })
  live.current = { ws, config, snapshot, pathname, aiSettings, proData }
  const mutations = useRef({ addDrafts, deleteTask, updateTask, createLabel, addLabel, removeLabel, complete, reopen })
  mutations.current = { addDrafts, deleteTask, updateTask, createLabel, addLabel, removeLabel, complete, reopen }

  useEffect(() => {
    const list = () => listInfoOf(live.current.pathname, live.current.ws, useVoiceListStore.getState().defaults, toLocalDate)
    setAskDeps({
      list,
      defaultProjectId: () => defaultProjectFor(live.current.ws, list()),
      speak: (text) => {
        if (live.current.aiSettings?.speakAnswers === false) return
        // Already talking again: the answer stays on screen, unread.
        if (openMicOwner() === 'ask' && openMicHearing()) return
        speakAnswer(text)
      },
      tools: () => ({
        ws: live.current.ws,
        now: () => new Date(),
        fetchTasks: async (params) => {
          const result = await api.fetchTasks(params)
          if (!result.success) throw new Error(result.error)
          return result.data ?? []
        },
        fetchTask: async (id) => {
          const result = await api.fetchTaskById(id)
          return result.success ? result.data : null
        },
        syncedValues: live.current.snapshot.values,
        pro: live.current.proData,
        review: {
          enabled: live.current.config?.review?.enabled === true,
          defaultCadenceDays: live.current.config?.review?.default_cadence_days ?? 14,
          excludeInbox: live.current.config?.review?.exclude_inbox === true,
        },
      }),
      apply: () => {
        const m = mutations.current
        return {
          addDrafts: (drafts) => m.addDrafts(drafts),
          deleteTask: (task) => m.deleteTask.mutateAsync({ task, deleteSubtasks: false }),
          updateTask: async (task, changes) => { await m.updateTask.mutateAsync({ id: task.id, changes, original: task }) },
          createLabel: (title) => m.createLabel.mutateAsync({ title }),
          addLabel: async (task, label) => { await m.addLabel.mutateAsync({ taskId: task.id, labelId: label.id }) },
          removeLabel: async (task, labelId) => { await m.removeLabel.mutateAsync({ taskId: task.id, labelId }) },
          complete: async (task) => { await m.complete.mutateAsync(task) },
          reopen: async (task) => { await m.reopen.mutateAsync(task) },
        }
      },
    })
    return () => setAskDeps(null)
  }, [])

  // Talking does not interrupt while a card waits (it answers it, 6.1) or after one was decided.
  useEffect(() => useAskStore.subscribe((s) => setOpenMicInterruptible(s.pending === null && !s.decided)), [])

  // Mod+J shows or hides Ask.
  useEffect(() => {
    if (!ready.ask) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.isComposing || e.key.toLowerCase() !== 'j') return
      e.preventDefault()
      e.stopPropagation()
      useAskStore.getState().setOpen(!useAskStore.getState().open)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [ready.ask])

  if (!open) return null
  return <AskPane ready={ready} />
}

function AskPane({ ready }: { ready: { ask: boolean; talk: boolean } }) {
  const state = useAskStore()
  const { conversations, currentId, busy, streaming, status, pending, lingering, error, talk } = state
  const conversation = conversations.find((c) => c.id === currentId) ?? null
  const knownIds = useMemo(() => new Set(conversation?.taskIds ?? []), [conversation?.taskIds])
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { data: aiSettings } = useAiSettings()
  const saveAi = useSaveAiSettings()

  useEffect(() => {
    // Commands from elsewhere (the comments pane shares the column) leave this pane alone.
    useUIStore.getState().setCommentsPaneOpen(false)
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [conversation?.messages.length, streaming, pending])

  const close = () => {
    stopSpeaking()
    state.setOpen(false)
  }

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void state.send(text)
  }

  if (!ready.ask) {
    return (
      <AskFrame onClose={close}>
        <div className="p-4 text-meta text-[var(--text-secondary)]">
          Ask needs a provider and a model that passed Test connection. Set it up in Settings, Assistant.
        </div>
      </AskFrame>
    )
  }

  return (
    <AskFrame
      onClose={close}
      toolbar={
        <>
          {conversations.length > 0 && (
            <select
              aria-label="Conversation"
              value={currentId ?? ''}
              onChange={(e) => (e.target.value ? state.select(e.target.value) : state.newChat())}
              disabled={busy}
              className="min-w-0 max-w-[9rem] rounded-control border border-[var(--border-color)] bg-transparent px-1 py-0.5 text-caption text-[var(--text-primary)]"
            >
              <option value="">New chat</option>
              {conversations.map((c) => <option key={c.id} value={c.id}>{c.title || 'Conversation'}</option>)}
            </select>
          )}
          <IconButton label="New chat" onClick={() => state.newChat()} disabled={busy}><MessageSquarePlus className="h-4 w-4" /></IconButton>
          {ready.talk && (
            <IconButton label={talk ? 'Talk is on' : 'Talk is off'} pressed={talk} onClick={() => state.setTalk(!talk)}>
              {talk ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </IconButton>
          )}
        </>
      }
    >
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
        {!conversation || conversation.messages.length === 0 ? (
          <>
            <AskAgenda onSend={(text) => void state.send(text)} disabled={busy} />
            <p className="text-meta text-[var(--text-secondary)]">
              Or ask anything about your tasks, such as “Move the dentist to Friday”.
              {ready.talk && ' Or turn on the microphone and just talk.'}
            </p>
          </>
        ) : (
          conversation.messages.map((stored, i) => <MessageView key={i} message={stored.message} knownIds={knownIds} />)
        )}
        {streaming && <AssistantText text={streaming} knownIds={knownIds} />}
        {status && (
          <p className="flex items-center gap-2 text-caption text-[var(--text-secondary)]" role="status">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> {status}
          </p>
        )}
        {lingering && <ProposalCard card={lingering} which="lingering" />}
        {pending && <ProposalCard card={pending} which="pending" />}
        {error && <p className="text-meta text-danger" role="alert">{error}</p>}
      </div>
      <div className="border-t border-[var(--border-color)] p-3">
        {ready.talk && <HeardLine />}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            aria-label="Message"
            rows={2}
            value={draft}
            placeholder="Ask about your tasks"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            className="min-h-[2.5rem] flex-1 resize-none rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-task-title text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
          />
          {ready.talk && <MicButton />}
          {busy && !pending ? (
            <IconButton label="Stop" onClick={() => state.cancel()}><Square className="h-4 w-4" /></IconButton>
          ) : (
            <IconButton label="Send" onClick={submit} disabled={!draft.trim()}><Send className="h-4 w-4" /></IconButton>
          )}
        </div>
        {aiSettings && talk && (
          <label className="mt-2 flex items-center gap-2 text-caption text-[var(--text-secondary)]">
            <Checkbox checked={aiSettings.speakAnswers} onChange={(e) => void saveAi({ speakAnswers: e.target.checked })} />
            Read answers aloud
          </label>
        )}
      </div>
    </AskFrame>
  )
}

function AskFrame({ children, onClose, toolbar }: { children: React.ReactNode; onClose: () => void; toolbar?: React.ReactNode }) {
  return (
    <aside
      id="ask-pane"
      aria-label="Ask"
      className="vicu-pane-in flex w-[380px] shrink-0 flex-col overflow-hidden border-l border-[var(--border-color)] bg-[var(--bg-sidebar)]"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="h-8 shrink-0" />
      <header className="flex items-center gap-1 border-b border-[var(--border-color)] px-3 pb-2">
        <Sparkles className="h-4 w-4 text-accent-blue" aria-hidden="true" />
        <h2 className="mr-auto text-card-title text-[var(--text-primary)]">Ask</h2>
        {toolbar}
        <IconButton label="Close Ask" onClick={onClose}><X className="h-4 w-4" /></IconButton>
      </header>
      {children}
    </aside>
  )
}

function IconButton({ label, title, onClick, disabled, pressed, children }: { label: string; title?: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50',
        pressed && 'bg-accent-blue/15 text-accent-blue',
      )}
    >
      {children}
    </button>
  )
}

function MessageView({ message, knownIds }: { message: ChatMessage; knownIds: ReadonlySet<number> }) {
  if (message.role === 'tool') return null
  if (message.role === 'user') {
    const words = userWords(message.text)
    // The final-answer request and empty turns are the app's own.
    if (!words.trim() || words === 'Answer now with what you found.') return null
    return (
      <div className="ml-8 whitespace-pre-wrap break-words rounded-card bg-accent-blue/10 px-3 py-2 text-task-title text-[var(--text-primary)]">
        {words}
      </div>
    )
  }
  if (!message.text.trim()) return null
  return <AssistantText text={message.text} knownIds={knownIds} />
}

/** Model text as plain text (no images or links fetched), `[task:<id>]` marks as task rows (5.1, 5.6). */
function AssistantText({ text, knownIds }: { text: string; knownIds: ReadonlySet<number> }) {
  const parts = answerParts(text, knownIds)
  return (
    <div className="space-y-1 text-task-title text-[var(--text-primary)]">
      {parts.map((part, i) => ('taskId' in part
        ? <AskTaskRow key={i} taskId={part.taskId} />
        : <p key={i} className="whitespace-pre-wrap break-words">{part.text.replace(/^\n+|\n+$/g, '')}</p>))}
    </div>
  )
}

function AskTaskRow({ taskId }: { taskId: number }) {
  const { data: task } = useQuery({
    queryKey: ['ai-task', taskId],
    queryFn: async () => {
      const result = await api.fetchTaskById(taskId)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    staleTime: 30_000,
  })
  const openTask = useOpenTask()
  const complete = useCompleteTask()
  const reopen = useUncompleteTask()
  const fmt = useDateFormat()
  const [done, setDone] = useState<boolean | null>(null)
  if (!task) return <div className="h-8 rounded-control bg-[var(--bg-secondary)]" aria-hidden="true" />
  const isDone = done ?? task.done
  const due = !isNoDueDate(task.due_date) ? formatDateChip(new Date(task.due_date), isDateOnly(task.due_date), new Date(), fmt) : null
  return (
    <div className="flex items-center gap-2 rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5">
      <Checkbox
        aria-label={isDone ? `Reopen ${task.title}` : `Complete ${task.title}`}
        checked={isDone}
        onChange={(e) => {
          setDone(e.target.checked)
          const mutation = e.target.checked ? complete.mutateAsync(task) : reopen.mutateAsync({ ...task, done: true })
          mutation.catch(() => setDone(null))
        }}
      />
      <button
        type="button"
        onClick={() => openTask(task.id)}
        className={cn('min-w-0 flex-1 truncate text-left text-task-title', isDone ? 'text-[var(--text-secondary)] line-through' : 'text-[var(--text-primary)]')}
      >
        {task.title}
      </button>
      {due && <span className="shrink-0 text-caption text-[var(--text-secondary)]">{due}</span>}
    </div>
  )
}

const SKIP_TEXT: Record<string, string> = { not_found: 'not found', read_only: 'read only', invalid: 'no change' }
const PRIORITY_NAMES = ['no priority', 'low', 'medium', 'high', 'urgent', 'do now']

function ProposalCard({ card, which }: { card: PendingProposal; which: 'pending' | 'lingering' }) {
  const ws = useAiWorkspace()
  const fmt = useDateFormat()
  const decide = useAskStore((s) => s.decide)
  const qc = useQueryClient()
  const { proposal } = card
  // A skipped task by its title when a row of this conversation loaded it, else by its id.
  const skippedName = (id: number) => qc.getQueryData<Task>(['ai-task', id])?.title ?? `task ${id}`
  const nothingToApply = proposalSize(proposal) === 0
  const editCard = useAskStore((s) => s.editCard)
  const editDue = (key: number | string, due: string | null) => editCard(which, withEditedDue(proposal, key, due))

  let title: string
  let rows: React.ReactNode
  if (proposal.tool === 'propose_create_tasks') {
    title = proposal.drafts.length === 1 ? 'Add 1 task' : `Add ${proposal.drafts.length} tasks`
    rows = proposal.drafts.map((draft) => (
      <li key={draft.ref} className="space-y-0.5">
        <p className="text-task-title text-[var(--text-primary)]">{draft.title}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-[var(--text-secondary)]">
          <CardDueChip due={draft.due} guessed={draft.guessed.includes('when')} onChange={(due) => editDue(draft.ref, due)} />
          <span>{[pathOf(ws, draft.project_id), ...draft.labels.map((l) => `#${l.title}`), draft.subtasks.length ? `${draft.subtasks.length} steps` : ''].filter(Boolean).join(' · ')}</span>
        </div>
      </li>
    ))
  } else if (proposal.tool === 'propose_complete_tasks') {
    title = proposal.done ? 'Mark done' : 'Open again'
    rows = proposal.tasks.map((task) => <li key={task.id} className="text-task-title text-[var(--text-primary)]">{task.title}</li>)
  } else {
    title = proposal.updates.length === 1 ? 'Change 1 task' : `Change ${proposal.updates.length} tasks`
    rows = proposal.updates.map((item) => (
      <li key={item.task.id} className="space-y-0.5">
        <p className="text-task-title text-[var(--text-primary)]">{item.task.title}</p>
        <ul className="text-caption text-[var(--text-secondary)]">
          {item.title !== undefined && <li>Title: {item.title}</li>}
          {item.due !== undefined && (
            <li className="flex items-center gap-1.5 py-0.5">
              Due
              <CardDueChip due={item.due} guessed={item.dueGuessed} onChange={(due) => editDue(item.task.id, due)} />
            </li>
          )}
          {item.projectId !== undefined && <li>Project: {pathOf(ws, item.projectId)}</li>}
          {item.priority !== undefined && <li>Priority: {PRIORITY_NAMES[item.priority] ?? item.priority}</li>}
          {item.labelsAdd.length > 0 && <li>Add labels: {item.labelsAdd.map((l) => l.title).join(', ')}</li>}
          {item.labelsRemove.length > 0 && <li>Remove labels: {item.labelsRemove.map((l) => l.title).join(', ')}</li>}
          {item.appendNotes !== undefined && <li>Add to notes: {item.appendNotes}</li>}
        </ul>
      </li>
    ))
  }

  return (
    <section aria-label={title} className="rounded-card border border-accent-blue/40 bg-[var(--bg-primary)] p-3" data-proposal={proposal.tool}>
      <h3 className="text-card-title text-[var(--text-primary)]">{nothingToApply ? 'Nothing to change' : title}</h3>
      <ul className="mt-2 space-y-2">{rows}</ul>
      {proposal.skipped.length > 0 && (
        <p className="mt-2 text-caption text-[var(--text-secondary)]">
          Skipped: {proposal.skipped.map((s) => `${skippedName(s.task_id)} (${SKIP_TEXT[s.reason]})`).join(', ')}
        </p>
      )}
      {proposal.tool === 'propose_create_tasks' && proposal.dropped.length > 0 && (
        <p className="mt-1 text-caption text-[var(--text-secondary)]">Not used: {proposal.dropped.map((d) => d.field).join(', ')}</p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        {nothingToApply ? (
          // Answered as applied-with-nothing (status failed, the skipped list), so the model learns why.
          <Button variant="primary" onClick={() => void decide(true, which)}>OK</Button>
        ) : (
          <>
            <Button variant="quiet" onClick={() => void decide(false, which)}>Decline</Button>
            <Button variant="primary" onClick={() => void decide(true, which)}>Apply</Button>
          </>
        )}
      </div>
    </section>
  )
}

/** A date on a proposal card: opens the When panel, and the date chosen is the one applied (5.4). */
function CardDueChip({ due, guessed, onChange }: { due: string | null; guessed: boolean; onChange: (due: string | null) => void }) {
  const fmt = useDateFormat()
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const text = due ? formatDateChip(instantOfLocal(due), due.endsWith('T23:59:59'), new Date(), fmt) : 'No date'
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Change the date, ${text}`}
        className={cn(
          'rounded-control border border-[var(--border-color)] px-1.5 py-0.5 text-caption text-[var(--text-primary)] transition-colors duration-fade-fast hover:bg-[var(--bg-hover)]',
          guessed && 'border-dashed',
        )}
      >
        {text}
      </button>
      {open && (
        <WhenPopover
          anchorRef={anchor}
          currentDate={due ? dueForApi(due) : NULL_DATE}
          allowClear
          onDateChange={(iso) => onChange(isNoDueDate(iso) ? null : localDateTimeOf(new Date(iso)))}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/**
 * Talk (6): the microphone stays on (3.7) and each pause sends what was said; with a card open a
 * yes or no answers it (6.1). While an answer is read aloud it pauses; pressing it then stops the
 * voice and listens at once.
 */
function MicButton() {
  const status = useOpenMicStore((m) => (m.owner === 'ask' ? m.status : 'off'))
  const on = status !== 'off'
  const title = status === 'paused' ? 'Stop reading and listen' : on ? 'Turn off the microphone' : 'Turn on the microphone and talk'
  const toggle = () => {
    if (status === 'paused') stopSpeaking()
    else if (on) stopOpenMic()
    else startTalk()
  }
  return (
    <IconButton label="Microphone" title={title} pressed={on} onClick={toggle}>
      <Mic className="h-4 w-4" />
    </IconButton>
  )
}

/** What the open microphone hears, or why it waits. */
function HeardLine() {
  const { owner, status, words } = useOpenMicStore()
  if (owner !== 'ask') return null
  const text = words || (status === 'starting' ? 'Starting…' : status === 'paused' ? 'Reading the answer…' : 'Listening…')
  return (
    <p className="mb-2 flex items-start gap-2 text-caption" role="status" data-heard-line="">
      <span className="relative mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
        {status === 'listening' && <span className="vicu-voice-pulse absolute inset-0 rounded-full bg-accent-blue/25" />}
        <Mic className="relative h-3.5 w-3.5 text-accent-blue" />
      </span>
      <span className={cn('min-w-0 break-words', words ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}>{text}</span>
    </p>
  )
}
