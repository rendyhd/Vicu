import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { Loader2, Mic, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '@/components/shared/Button'
import { cn } from '@/lib/cn'
import { useAiSettings, useAiWorkspace, useSaveAiSettings } from '@/hooks/use-ai'
import { useAddVoiceTask } from '@/hooks/use-add-voice-task'
import { useDateFormat } from '@/hooks/use-date-format'
import { useCreateProject, useDeleteProject, useDeleteTask } from '@/hooks/use-task-mutations'
import { useAddDrafts } from '@/hooks/use-add-drafts'
import { api } from '@/lib/api'
import { addBrainDump, addedMessage, undoBrainDump } from '@/lib/ai/add-brain-dump'
import { cancelOpenMic, stopOpenMic, useOpenMicStore } from '@/lib/ai/open-mic'
import { contextProjects, defaultProjectFor, listInfoOf, pathOf } from '@/lib/ai/workspace'
import { formatDateChip, midSentence } from '@/lib/date-utils'
import { toLocalDate } from '@/lib/due-dates'
import { describeMutationError } from '@/lib/mutation-errors'
import { UNDO_TOAST_MS, toast, useToastStore } from '@/stores/toast-store'
import { setDictationDeps, useDictationStore, type CardDraft, type DraftCard, type DictationPhase } from '@/stores/dictation-store'
import { useVoiceListStore } from '@/stores/voice-list-store'
import { BrainDumpSwitch, DumpEditor, PlanView, UpdateField } from './BrainDumpViews'
import { NotesCardBar, NotesDecisions, NotesPlanBar, cardChoice, useAddNotesPlan, useNotesWorld } from './NotesPlanViews'
import { useTranslation } from 'react-i18next'
import { usePro } from '@/hooks/use-pro'
import { useNotesStore } from '@/stores/notes-store'
import { canUpdateNotes } from '../../../shared/ai/notes'
import { planProjectPath } from '../../../shared/ai/brain-dump'
import { instantOfLocal } from '../../../shared/ai/dictation'
import type { DraftField } from '../../../shared/ai/contract'
import type { Task } from '@/lib/vikunja-types'
import type { TranslationKey } from '../../../shared/i18n'

const FIELD_NAMES: Record<string, TranslationKey> = {
  task: 'ai.dictationPanel.fieldTask',
  title: 'ai.dictationPanel.fieldTitle',
  notes: 'ai.dictationPanel.fieldNotes',
  when: 'ai.dictationPanel.fieldDate',
  project: 'ai.dictationPanel.fieldProject',
  labels: 'ai.dictationPanel.fieldLabels',
  priority: 'ai.dictationPanel.fieldPriority',
  repeat: 'ai.dictationPanel.fieldRepeat',
  reminder: 'ai.dictationPanel.fieldReminder',
  place: 'ai.dictationPanel.fieldPlace',
  subtasks: 'ai.dictationPanel.fieldSubtasks',
}

/** The repeat units the model may name (the contract's enum), each with its plural forms. */
const REPEAT_TEXT: Record<string, TranslationKey> = {
  day: 'ai.dictationPanel.repeatDay',
  week: 'ai.dictationPanel.repeatWeek',
  month: 'ai.dictationPanel.repeatMonth',
  year: 'ai.dictationPanel.repeatYear',
}

const PRIORITIES: { value: number; label: TranslationKey }[] = [
  { value: 0, label: 'ai.dictationPanel.priorityNone' },
  { value: 1, label: 'ai.dictationPanel.priorityLow' },
  { value: 2, label: 'ai.dictationPanel.priorityMedium' },
  { value: 3, label: 'ai.dictationPanel.priorityHigh' },
  { value: 4, label: 'ai.dictationPanel.priorityUrgent' },
]

function droppedValue(value: unknown, nothing: string): string {
  if (typeof value === 'string') return `“${value}”`
  if (value === null || value === undefined) return nothing
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/**
 * Smart dictation's draft cards (docs/ai-assistant-v1.md section 4): what the model made of the
 * words, checked, editable by hand and by voice, added in one go. While the microphone is open
 * (3.7) the panel shows the words being heard; each pause sends them, so cards appear and change
 * while the person talks. With Brain dump on (4.8) the words go into a dump instead, Organize
 * sends it, and the plan shows new projects with the tasks grouped by project. Mounted once, in
 * AppShell. Also shows a transcript kept after a failed request (4.6) when the app starts.
 */
export function DictationHost() {
  const phase = useDictationStore((s) => s.phase)
  const ws = useAiWorkspace()
  const { data: settings } = useAiSettings()
  const saveAi = useSaveAiSettings()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const live = useRef({ ws, pathname, settings, saveAi })
  live.current = { ws, pathname, settings, saveAi }

  useEffect(() => {
    setDictationDeps({
      workspace: () => live.current.ws,
      locale: () => navigator.language,
      list: () => listInfoOf(live.current.pathname, live.current.ws, useVoiceListStore.getState().defaults, toLocalDate),
      brainDump: () => live.current.settings?.brainDump === true,
      rememberBrainDump: (on) => void live.current.saveAi({ brainDump: on }).catch(() => {}),
    })
    return () => setDictationDeps(null)
  }, [])

  // A transcript kept after a failed request comes back when the app starts (4.6).
  useEffect(() => {
    let cancelled = false
    void window.api.ai.getKeptTranscripts().then((kept) => {
      const first = kept[0]
      if (cancelled || !first || useDictationStore.getState().phase !== 'idle') return
      useDictationStore.setState({
        phase: 'failed',
        source: 'voice',
        transcript: first.transcript,
        reference: first.reference,
        list: first.list ? { name: first.list.name, projectId: first.list.projectId, defaultDue: first.list.defaultDue } : null,
        parent: null,
        cards: [],
        unclear: [],
        error: first.error,
        keptId: first.id,
        // A brain dump comes back as one (4.8.6): Retry organizes it again, Edit goes back to it.
        sent: true,
        brainDump: first.brainDump === true,
        dump: first.brainDump === true ? first.transcript : '',
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (phase === 'idle') return null
  return <DictationPanel />
}

function DictationPanel() {
  const state = useDictationStore()
  const { phase, cards, unclear, transcript, error, source, parent, edit, brainDump, dump, projects, addError, sent } = state
  const ws = useAiWorkspace()
  const addDraftsNow = useAddDrafts()
  const deleteTask = useDeleteTask()
  const createProject = useCreateProject({ silent: true })
  const deleteProjectQuietly = useDeleteProject({ silent: true })
  const deleteProject = useDeleteProject()
  const addVoiceTask = useAddVoiceTask()
  const panelRef = useRef<HTMLElement>(null)
  const { t } = useTranslation()
  const notes = state.notes
  const notesWorld = useNotesWorld(notes?.agreed ?? false)
  const addNotes = useAddNotesPlan(ws, notesWorld)
  const pro = usePro()
  const [notesToLog, setNotesToLog] = useState(false)

  // A plan of notes is never thrown away by closing: it goes back to the pages (4.9.9).
  const close = useCallback((discard = true) => {
    if (useDictationStore.getState().notes) {
      useDictationStore.getState().close({ discard: false })
      useNotesStore.getState().backToPages()
      return
    }
    useDictationStore.getState().close({ discard })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (!panelRef.current?.contains(document.activeElement) && document.activeElement !== document.body) return
      const now = useDictationStore.getState()
      // A brain dump with something in it is closed with Cancel only, never by a stray Escape (a
      // failed one is kept anyway).
      if (now.brainDump && now.phase !== 'failed' && (now.phase !== 'live' || now.dump.trim() !== '')) return
      event.preventDefault()
      // A kept transcript stays unless the user discards it on purpose.
      close(now.phase !== 'failed')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  /**
   * A brain dump's Add (4.8.5): the new projects first (they need a connection), then the tasks;
   * a project that cannot be created stops it before any task, with the plan left as it was.
   */
  const addPlan = async () => {
    const store = useDictationStore.getState()
    if (store.cards.length === 0 && store.projects.length === 0) return
    if (useOpenMicStore.getState().owner === 'dictation') cancelOpenMic()
    store.cancelRequest()
    const plan = useDictationStore.getState()
    if (plan.projects.length > 0 && !navigator.onLine) {
      plan.setAddError(t('ai.dictationPanel.needsConnection'))
      return
    }
    plan.setAddError(null)
    plan.setPhase('adding')
    const outcome = await addBrainDump(plan.projects, plan.cards.map((card) => card.draft), {
      createProject: (title, parentId) => createProject.mutateAsync({ title, ...(parentId ? { parent_project_id: parentId } : {}) }),
      deleteProject: (id) => deleteProjectQuietly.mutateAsync(id),
      addDrafts: (drafts) => addDraftsNow(drafts),
      defaultProjectId: defaultProjectFor(ws, plan.list),
    })
    if (!outcome.ok) {
      const after = useDictationStore.getState()
      // Closed while it ran: nothing of a failed project stayed, and a failed task had its toast.
      if (after.phase === 'idle') return
      if (outcome.stage === 'projects') {
        after.setAddError(t('ai.dictationPanel.projectNotCreated', { title: outcome.project.title, message: describeMutationError(outcome.error).message }))
      } else {
        // The task's create failed with the app's usual error toast; its projects exist now.
        after.projectsCreated(outcome.projectIds)
      }
      after.setPhase('cards')
      return
    }
    close(true)
    for (const problem of outcome.added.problems) toast.error(problem)
    useToastStore.getState().push('success', addedMessage(outcome.projects.length, outcome.added.tasks.length), {
      durationMs: UNDO_TOAST_MS,
      action: {
        label: t('ai.undo'),
        onAction: () => {
          void undoBrainDump(outcome.added, outcome.projects, {
            deleteTask: async (task) => { await deleteTask.mutateAsync({ task, deleteSubtasks: false }) },
            deleteProject: async (id) => { await deleteProject.mutateAsync(id) },
          })
        },
      },
    })
  }

  const addAll = async () => {
    if (useDictationStore.getState().notes) return addNotes({ toLog: notesToLog && pro.layer('portfolio') })
    if (useDictationStore.getState().brainDump) return addPlan()
    const drafts = useDictationStore.getState().cards.map((card) => card.draft)
    if (drafts.length === 0) return
    // Add means done: the microphone and an edit still running stop here.
    if (useOpenMicStore.getState().owner === 'dictation') cancelOpenMic()
    useDictationStore.getState().cancelRequest()
    useDictationStore.getState().setPhase('adding')
    let parentTask: Task | null = null
    if (parent) {
      const fetched = await api.fetchTaskById(parent.id).catch(() => null)
      parentTask = fetched && fetched.success ? fetched.data : ({ id: parent.id, title: parent.title, project_id: parent.project_id } as Task)
    }
    try {
      // Dictation's drafts always name a project of the context.
      const result = await addDraftsNow(drafts.map(({ project_ref: _ref, ...draft }) => ({ ...draft, project_id: draft.project_id ?? defaultProjectFor(ws, null) })), parentTask)
      close(true)
      for (const problem of result.problems) toast.error(problem)
      const count = result.tasks.length
      useToastStore.getState().push('success', t('ai.ask.addedTasks', { count }), {
        durationMs: UNDO_TOAST_MS,
        action: {
          label: t('ai.undo'),
          onAction: () => {
            void (async () => {
              for (const task of [...result.created].reverse()) {
                await deleteTask.mutateAsync({ task, deleteSubtasks: false }).catch(() => {})
              }
            })()
          },
        },
      })
    } catch {
      // The create failed with the app's usual error toast; the cards stay to try again.
      useDictationStore.getState().setPhase('cards')
    }
  }

  const addAsOneTask = async () => {
    const list = useDictationStore.getState().list
    const added = await addVoiceTask(transcript, list ? {
      projectId: list.projectId,
      defaultDueDate: list.defaultDue ? instantOfLocal(`${list.defaultDue}T12:00:00`) : null,
    } : null)
    if (added) close(true)
  }

  const micOn = useOpenMicStore((m) => m.owner === 'dictation')
  const taskCount = t('ai.counts.tasks', { count: cards.length })
  const heading = source === 'steps' && parent
    ? t('ai.dictationPanel.stepsFor', { title: parent.title })
    : phase === 'live' ? (micOn ? t('ai.dictationPanel.listening') : brainDump ? t('ai.dictationPanel.brainDump') : t('ai.dictationPanel.dictateTasks'))
    : phase === 'requesting' ? (brainDump ? t('ai.dictationPanel.organizing') : t('ai.dictationPanel.makingTasks'))
    : phase === 'failed' ? (brainDump ? t('ai.dictationPanel.dumpFailed') : t('ai.dictationPanel.tasksFailed'))
    : phase === 'empty' ? t('ai.dictationPanel.nothingToAdd')
    : brainDump && projects.length > 0 ? t('ai.dictationPanel.projectsAndTasks', { projects: t('ai.counts.newProjects', { count: projects.length }), tasks: taskCount })
    : taskCount
  const addLabel = brainDump && projects.length > 0
    ? addedMessage(projects.length, cards.length).replace(/^Added/, 'Add')
    : t('ai.dictationPanel.addTask', { count: cards.length })
  const newProjects = useMemo(
    () => projects.map((project) => ({ ref: project.ref, label: planProjectPath(project.ref, projects, (id) => pathOf(ws, id)) })),
    [projects, ws],
  )
  const notesTicked = notes ? cards.filter((card) => cardChoice(card, notes, notesWorld).ticked).length : 0
  const shownHeading = notes && (phase === 'cards' || phase === 'adding') ? (notes.title.trim() || t('notes.title')) : heading
  const renderCard = (card: DraftCard) => {
    const ticked = notes ? cardChoice(card, notes, notesWorld).ticked : true
    return (
      <DraftCardView
        card={card}
        disabled={phase === 'adding'}
        ws={ws}
        newProjects={newProjects}
        dimmed={!ticked}
        extra={notes ? <NotesCardBar card={card} notes={notes} world={notesWorld} disabled={phase === 'adding'} /> : null}
      />
    )
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[55] flex justify-center px-4">
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={notes ? t('notes.title') : brainDump ? t('ai.dictationPanel.dialogBrainDump') : t('ai.dictationPanel.dialogDictated')}
        data-dictation-panel=""
        data-phase={phase}
        className={cn(
          'vicu-voice-card pointer-events-auto flex w-full flex-col rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-lg',
          notes ? 'max-h-[86vh] max-w-3xl' : 'max-h-[72vh] max-w-xl',
        )}
      >
        <header className="flex items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
          <Sparkles className="h-4 w-4 text-accent-blue" aria-hidden="true" />
          <h2 className="flex-1 text-card-title text-[var(--text-primary)]">{shownHeading}</h2>
          {phase !== 'adding' && <MicToggle />}
          <button
            type="button"
            aria-label={notes ? t('notes.plan.backToPages') : t('ai.dictationPanel.close')}
            onClick={() => close(phase !== 'failed')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {phase === 'live' && (
            <div className="space-y-3">
              {source === 'voice' && !sent && <BrainDumpSwitch />}
              <HeardLine phase={phase} brainDump={brainDump} />
              {brainDump ? (
                <DumpEditor />
              ) : (
                <p className="text-caption text-[var(--text-secondary)]">
                  {micOn ? t('ai.dictationPanel.pauseHint') : t('ai.dictationPanel.micHint')}
                </p>
              )}
            </div>
          )}

          {phase === 'requesting' && (
            <div className="flex items-start gap-2 text-meta text-[var(--text-secondary)]" role="status">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
              <p className={cn('break-words', brainDump && 'whitespace-pre-wrap')}>{transcript}</p>
            </div>
          )}

          {(phase === 'failed' || phase === 'empty') && (
            <div className="space-y-2">
              <HeardLine phase={phase} brainDump={brainDump} />
              {phase === 'failed' && error && <p className="text-meta text-danger" role="alert">{error}</p>}
              {phase === 'empty' && <p className="text-meta text-[var(--text-secondary)]">{t('ai.dictationPanel.noTasksFound')}</p>}
              <blockquote className="whitespace-pre-wrap break-words rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-task-title text-[var(--text-primary)]">
                {transcript}
              </blockquote>
              {unclear.length > 0 && <UnclearNotes notes={unclear} />}
            </div>
          )}

          {(phase === 'cards' || phase === 'adding') && brainDump && (
            <div className="space-y-3">
              {addError && <p className="text-meta text-danger" role="alert">{addError}</p>}
              {edit.phase === 'requesting' && (
                <p className="flex items-center gap-2 text-meta text-[var(--text-secondary)]" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>{t('ai.dictationPanel.updating', { words: edit.words })}</span>
                </p>
              )}
              {edit.error && <p className="text-meta text-danger" role="alert">{edit.error}</p>}
              {notes && <NotesPlanBar notes={notes} world={notesWorld} cards={cards} disabled={phase === 'adding'} />}
              <PlanView ws={ws} disabled={phase === 'adding'} renderCard={renderCard} />
              {notes && <NotesDecisions notes={notes} toLog={notesToLog} onToLog={setNotesToLog} showLog={pro.layer('portfolio')} />}
              {unclear.length > 0 && <UnclearNotes notes={unclear} />}
              {phase === 'cards' && !notes && <HeardLine phase={phase} brainDump />}
              {(!notes || canUpdateNotes(notes.batches, cards.length)) && <UpdateField disabled={phase === 'adding'} />}
            </div>
          )}

          {(phase === 'cards' || phase === 'adding') && !brainDump && (
            <div className="space-y-3">
              {edit.phase === 'requesting' && (
                <p className="flex items-center gap-2 text-meta text-[var(--text-secondary)]" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>{edit.words}</span>
                </p>
              )}
              {phase === 'cards' && <HeardLine phase={phase} />}
              {edit.error && <p className="text-meta text-danger" role="alert">{edit.error}</p>}
              <ul className="space-y-2" aria-label={t('ai.dictationPanel.tasksToAdd')}>
                {cards.map((card) => <li key={card.draft.ref}>{renderCard(card)}</li>)}
              </ul>
              {unclear.length > 0 && <UnclearNotes notes={unclear} />}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-color)] px-4 py-3">
          {(phase === 'failed' || phase === 'empty') && (
            <>
              <Button variant="quiet" danger onClick={() => close(true)}>{t('ai.dictationPanel.discard')}</Button>
              {brainDump
                ? <Button variant="secondary" onClick={() => useDictationStore.getState().editDump()}>{t('ai.dictationPanel.edit')}</Button>
                : <Button variant="secondary" onClick={() => void addAsOneTask()}>{t('ai.dictationPanel.addAsOne')}</Button>}
              <Button variant="primary" onClick={() => useDictationStore.getState().retry()}>{t('ai.dictationPanel.retry')}</Button>
            </>
          )}
          {phase === 'requesting' && brainDump && (
            <Button variant="quiet" title={t('ai.dictationPanel.backToDumpTitle')} onClick={() => useDictationStore.getState().cancelRequest()}>{t('ai.dictationPanel.backToDump')}</Button>
          )}
          {(phase === 'live' || (phase === 'requesting' && !brainDump)) && <Button variant="quiet" onClick={() => close(true)}>{t('ai.dictationPanel.cancel')}</Button>}
          {phase === 'live' && brainDump && (
            <Button variant="primary" disabled={dump.trim() === ''} onClick={() => useDictationStore.getState().organize()}>{t('ai.dictationPanel.organize')}</Button>
          )}
          {phase === 'live' && !brainDump && micOn && <Button variant="primary" onClick={() => stopOpenMic()}>{t('ai.dictationPanel.done')}</Button>}
          {(phase === 'cards' || phase === 'adding') && notes && (
            <>
              <Button variant="quiet" danger disabled={phase === 'adding'} onClick={() => useNotesStore.getState().discard()}>{t('notes.discard')}</Button>
              <Button variant="quiet" disabled={phase === 'adding'} onClick={() => close(false)}>{t('notes.plan.backToPages')}</Button>
              {micOn && phase === 'cards' && <Button variant="secondary" onClick={() => stopOpenMic()}>{t('notes.plan.done')}</Button>}
              <Button variant="primary" disabled={phase === 'adding' || notesTicked === 0} onClick={() => void addAll()}>
                {phase === 'adding' ? t('notes.plan.adding') : t('notes.plan.add', { count: notesTicked })}
              </Button>
            </>
          )}
          {(phase === 'cards' || phase === 'adding') && !notes && (
            <>
              <Button variant="quiet" onClick={() => close(true)}>{t('ai.dictationPanel.cancel')}</Button>
              {micOn && phase === 'cards' && <Button variant="secondary" onClick={() => stopOpenMic()}>{t('ai.dictationPanel.done')}</Button>}
              <Button variant="primary" disabled={phase === 'adding' || (cards.length === 0 && projects.length === 0)} onClick={() => void addAll()}>
                {phase === 'adding' ? t('ai.dictationPanel.adding') : addLabel}
              </Button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}

function UnclearNotes({ notes }: { notes: readonly string[] }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-control border border-[var(--border-color)] px-3 py-2">
      <p className="text-caption font-medium text-[var(--text-secondary)]">{t('ai.dictationPanel.notPlaced')}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-meta text-[var(--text-primary)]">
        {notes.map((note, i) => <li key={i}>{note}</li>)}
      </ul>
    </div>
  )
}

/** The microphone of smart dictation (3.7): on, it listens until Done; each pause sends the words. */
function MicToggle() {
  const { t } = useTranslation()
  const status = useOpenMicStore((m) => (m.owner === 'dictation' ? m.status : 'off'))
  const on = status !== 'off'
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={t('ai.dictationPanel.microphone')}
      title={on ? t('ai.dictationPanel.micTurnOff') : t('ai.dictationPanel.micTurnOn')}
      onClick={() => (on ? stopOpenMic() : useDictationStore.getState().listen())}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-control',
        on ? 'bg-accent-fill text-on-accent' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
      )}
    >
      <Mic className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

/** The words of the turn being heard (and those of a request that talking cancelled). */
function HeardLine({ phase, brainDump = false }: { phase: DictationPhase; brainDump?: boolean }) {
  const { t } = useTranslation()
  const { owner, status, words } = useOpenMicStore()
  if (owner !== 'dictation') return null
  const prompt = status === 'starting'
    ? t('ai.dictationPanel.heardStarting')
    : brainDump
      ? phase === 'cards' ? t('ai.dictationPanel.heardDumpCards') : t('ai.dictationPanel.heardDump')
      : phase === 'cards'
        ? t('ai.dictationPanel.heardCards')
        : t('ai.dictationPanel.heardSay')
  return (
    <p className="flex items-start gap-2 text-meta" role="status" data-heard-line="">
      <span className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
        {status === 'listening' && <span className="vicu-voice-pulse absolute inset-0 rounded-full bg-accent-blue/25" />}
        <Mic className="relative h-4 w-4 text-accent-blue" />
      </span>
      <span className={cn('min-w-0 break-words', words ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}>{words || prompt}</span>
    </p>
  )
}

interface DraftCardProps {
  card: DraftCard
  disabled: boolean
  ws: ReturnType<typeof useAiWorkspace>
  /** A brain dump's new projects (4.8.5), offered after the context's projects. */
  newProjects: ReadonlyArray<{ ref: string; label: string }>
  /** Shown above the card's fields (a plan of notes: the tick and who it is for). */
  extra?: ReactNode
  /** Drawn quieter: a card of notes that is not ticked. */
  dimmed?: boolean
}

function DraftCardView({ card, disabled, ws, newProjects, extra, dimmed = false }: DraftCardProps) {
  const { t } = useTranslation()
  const { draft, changed } = card
  // Where a line of notes came from (4.9.5) is only for the source line; a wrong one is left out quietly.
  const dropped = card.dropped.filter((d) => d.field !== 'from' && d.field !== 'page')
  const update = (change: Partial<CardDraft>) => useDictationStore.getState().updateDraft(draft.ref, change)
  const fmt = useDateFormat()
  const guessed = (field: DraftField) => draft.guessed.includes(field)
  const highlight = (field: DraftField) => changed.includes(field)
  const projects = useMemo(() => contextProjects(ws), [ws])
  const [showNotes, setShowNotes] = useState(draft.notes !== '')
  const [labelText, setLabelText] = useState('')

  const fieldClass = (field: DraftField) => cn(
    'rounded-chip border px-2 py-0.5 text-chip',
    guessed(field) ? 'border-dashed border-accent-blue' : 'border-[var(--border-color)]',
    highlight(field) && 'ring-2 ring-accent-blue/40',
  )
  // The date only: the time has its own field next to it.
  const dueLabel = draft.due ? formatDateChip(instantOfLocal(draft.due), true, new Date(), fmt) : null
  const place = draft.place ? ws.places.find((p) => p.id === draft.place?.place_id) : undefined
  const projectValue = draft.project_ref !== null ? `ref:${draft.project_ref}` : `id:${draft.project_id ?? 0}`

  return (
    <article
      aria-label={draft.title}
      data-draft-ref={draft.ref}
      data-dimmed={dimmed || undefined}
      className={cn('rounded-card border border-[var(--border-color)] p-3', highlight('title') && 'ring-2 ring-accent-blue/40', dimmed && 'opacity-60')}
    >
      {extra}
      <div className="flex items-start gap-2">
        <input
          aria-label={t('ai.dictationPanel.cardTitle')}
          value={draft.title}
          disabled={disabled}
          onChange={(e) => update({ title: e.target.value })}
          className={cn(
            'min-w-0 flex-1 rounded-control border bg-transparent px-2 py-1 text-task-title text-[var(--text-primary)]',
            guessed('title') ? 'border-dashed border-accent-blue' : 'border-transparent hover:border-[var(--border-color)]',
          )}
        />
        <button
          type="button"
          aria-label={t('ai.dictationPanel.removeTask', { title: draft.title })}
          disabled={disabled}
          onClick={() => useDictationStore.getState().removeDraft(draft.ref)}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-danger"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {showNotes ? (
        <textarea
          aria-label={t('ai.dictationPanel.notes')}
          value={draft.notes}
          disabled={disabled}
          rows={Math.min(4, Math.max(2, draft.notes.split('\n').length))}
          onChange={(e) => update({ notes: e.target.value })}
          className={cn(
            'mt-1 w-full resize-y rounded-control border bg-transparent px-2 py-1 text-meta text-[var(--text-primary)]',
            guessed('notes') ? 'border-dashed border-accent-blue' : 'border-[var(--border-color)]',
            highlight('notes') && 'ring-2 ring-accent-blue/40',
          )}
        />
      ) : (
        <button type="button" className="mt-1 text-caption text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={() => setShowNotes(true)}>
          {t('ai.dictationPanel.addNotes')}
        </button>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[var(--text-primary)]">
        <label className={cn(fieldClass('when'), 'inline-flex items-center gap-1')}>
          <span className="sr-only">{t('ai.dictationPanel.dueDate')}</span>
          <span aria-hidden="true">{dueLabel ?? t('ai.dictationPanel.noDate')}</span>
          <input
            type="date"
            disabled={disabled}
            value={draft.due ? draft.due.slice(0, 10) : ''}
            onChange={(e) => {
              const date = e.target.value
              if (!date) update({ due: null, reminder: draft.reminder && 'before_due_minutes' in draft.reminder ? null : draft.reminder })
              else update({ due: draft.due && !draft.due.endsWith('T23:59:59') ? `${date}${draft.due.slice(10)}` : `${date}T23:59:59` })
            }}
            className="w-5 cursor-pointer bg-transparent text-chip opacity-60 [&::-webkit-datetime-edit]:hidden"
          />
        </label>
        {draft.due && (
          <label className={cn(fieldClass('when'), 'inline-flex items-center gap-1')}>
            <span className="text-[var(--text-secondary)]">{t('ai.dictationPanel.time')}</span>
            <input
              type="time"
              disabled={disabled}
              value={draft.due.endsWith('T23:59:59') ? '' : draft.due.slice(11, 16)}
              onChange={(e) => update({ due: e.target.value ? `${draft.due!.slice(0, 10)}T${e.target.value}:00` : `${draft.due!.slice(0, 10)}T23:59:59` })}
              className="bg-transparent text-chip"
            />
          </label>
        )}

        <label className={fieldClass('project')}>
          <span className="sr-only">{t('ai.dictationPanel.project')}</span>
          <select
            disabled={disabled}
            value={projectValue}
            onChange={(e) => {
              const value = e.target.value
              if (value.startsWith('ref:')) update({ project_id: null, project_ref: value.slice(4) })
              else update({ project_id: Number(value.slice(3)), project_ref: null })
            }}
            className="max-w-[12rem] bg-transparent text-chip"
          >
            {projects.map((project) => (
              <option key={project.id} value={`id:${project.id}`}>{project.path}</option>
            ))}
            {draft.project_ref === null && !projects.some((p) => p.id === draft.project_id) && (
              <option value={projectValue}>{pathOf(ws, draft.project_id ?? 0) || t('ai.dictationPanel.inbox')}</option>
            )}
            {newProjects.length > 0 && (
              <optgroup label={t('ai.dictationPanel.newProjects')}>
                {newProjects.map((project) => <option key={project.ref} value={`ref:${project.ref}`}>{t('ai.dictationPanel.newProjectOption', { name: project.label })}</option>)}
              </optgroup>
            )}
          </select>
        </label>

        <label className={fieldClass('priority')}>
          <span className="sr-only">{t('ai.dictationPanel.priority')}</span>
          <select
            disabled={disabled}
            value={draft.priority ?? 0}
            onChange={(e) => update({ priority: Number(e.target.value) || null })}
            className="bg-transparent text-chip"
          >
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{t(p.label)}</option>)}
          </select>
        </label>

        {draft.labels.map((label) => (
          <span key={label.title} className={cn(fieldClass('labels'), 'inline-flex items-center gap-1')}>
            #{label.title}{label.id === null && <span className="text-[var(--text-secondary)]"> {t('ai.dictationPanel.newLabel')}</span>}
            <button
              type="button"
              aria-label={t('ai.dictationPanel.removeLabel', { title: label.title })}
              disabled={disabled}
              onClick={() => update({ labels: draft.labels.filter((l) => l !== label) })}
              className="text-[var(--text-secondary)] hover:text-danger"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          aria-label={t('ai.dictationPanel.addLabel')}
          placeholder={t('ai.dictationPanel.labelPlaceholder')}
          disabled={disabled}
          value={labelText}
          onChange={(e) => setLabelText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            const name = labelText.trim().replace(/^[#@*+]/, '').trim()
            if (!name || draft.labels.some((l) => l.title.toLowerCase() === name.toLowerCase())) return
            const existing = ws.labels.find((l) => l.title.toLowerCase() === name.toLowerCase())
            update({ labels: [...draft.labels, existing ? { id: existing.id, title: existing.title } : { id: null, title: name }] })
            setLabelText('')
          }}
          className="w-20 rounded-chip border border-transparent bg-transparent px-2 py-0.5 text-chip hover:border-[var(--border-color)]"
        />

        {draft.repeat && (
          <span className={cn(fieldClass('repeat'), 'inline-flex items-center gap-1')}>
            {REPEAT_TEXT[draft.repeat.unit] ? t(REPEAT_TEXT[draft.repeat.unit], { count: draft.repeat.every }) : `${draft.repeat.every} ${draft.repeat.unit}`}
            <button type="button" aria-label={t('ai.dictationPanel.removeRepeat')} disabled={disabled} onClick={() => update({ repeat: null })} className="text-[var(--text-secondary)] hover:text-danger">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        {draft.reminder && (
          <span className={cn(fieldClass('reminder'), 'inline-flex items-center gap-1')}>
            {'before_due_minutes' in draft.reminder
              ? t('ai.dictationPanel.remindBefore', { minutes: draft.reminder.before_due_minutes })
              : t('ai.dictationPanel.remindAt', { when: midSentence(formatDateChip(instantOfLocal(draft.reminder.at), false, new Date(), fmt)) })}
            <button type="button" aria-label={t('ai.dictationPanel.removeReminder')} disabled={disabled} onClick={() => update({ reminder: null })} className="text-[var(--text-secondary)] hover:text-danger">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        {draft.place && (
          <span className={cn(fieldClass('place'), 'inline-flex items-center gap-1')}>
            {t(draft.place.trigger === 'arrive' ? 'ai.dictationPanel.arrive' : 'ai.dictationPanel.leave', { place: place?.name ?? t('ai.dictationPanel.placeFallback') })}
            <button type="button" aria-label={t('ai.dictationPanel.removePlace')} disabled={disabled} onClick={() => update({ place: null })} className="text-[var(--text-secondary)] hover:text-danger">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>

      {draft.subtasks.length > 0 && (
        <ul className={cn('mt-2 space-y-1 border-l-2 pl-3', guessed('subtasks') ? 'border-dashed border-accent-blue' : 'border-[var(--border-color)]', highlight('subtasks') && 'ring-2 ring-accent-blue/40')} aria-label={t('ai.dictationPanel.subtasks')}>
          {draft.subtasks.map((subtask, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                aria-label={t('ai.dictationPanel.subtaskN', { n: i + 1 })}
                value={subtask}
                disabled={disabled}
                onChange={(e) => update({ subtasks: draft.subtasks.map((s, j) => (j === i ? e.target.value : s)) })}
                className="min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-1 text-meta text-[var(--text-primary)] hover:border-[var(--border-color)]"
              />
              <button type="button" aria-label={t('ai.dictationPanel.removeSubtask', { title: subtask })} disabled={disabled} onClick={() => update({ subtasks: draft.subtasks.filter((_, j) => j !== i) })} className="text-[var(--text-secondary)] hover:text-danger">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {dropped.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-caption text-[var(--text-secondary)]">
          {dropped.map((d, i) => (
            <li key={i}>{t('ai.dictationPanel.notUnderstood', { field: FIELD_NAMES[d.field] ? t(FIELD_NAMES[d.field]) : d.field, value: droppedValue(d.value, t('ai.dictationPanel.nothing')) })}</li>
          ))}
        </ul>
      )}
      {draft.guessed.length > 0 && (
        <p className="mt-1 text-caption text-[var(--text-secondary)]">{t('ai.dictationPanel.dashedCheck', { fields: draft.guessed.map((f) => (FIELD_NAMES[f] ? t(FIELD_NAMES[f]) : f)).join(', ') })}</p>
      )}
    </article>
  )
}
