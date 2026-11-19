import { create } from 'zustand'
import {
  changedFields,
  checkDictationAnswer,
  dictationUserMessage,
  draftsAsAnswer,
  localDateTimeOf,
  type CheckedDraft,
  type DictationAnswer,
  type DroppedField,
} from '../../shared/ai/dictation'
import {
  appendToDump,
  brainDumpUserMessage,
  changedProjects,
  checkBrainDumpAnswer,
  planAsAnswer,
  removePlanProject,
  type BrainDumpAnswer,
  type BrainDumpDraft,
  type CheckedProject,
} from '../../shared/ai/brain-dump'
import { AI_LIMITS, DICTATION_FIELDS, type DraftField } from '../../shared/ai/contract'
import {
  checkNotesAnswer,
  notesPlanAsAnswer,
  notesUserMessage,
  type NotesAnswer,
  type NotesDecisionAnswer,
  type NotesDraft,
  type NotesFilter,
  type NotesPage,
  type NotesPlan,
  type NotesQuestionAnswer,
  type OwnerAction,
} from '../../shared/ai/notes'
import type { AiError, KeptTranscript } from '../../shared/ai/types'
import { joinWords } from '../../shared/ai/turns'
import { contextProjects, defaultProjectFor, dictationContextFor, type AiWorkspace, type ListInfo } from '@/lib/ai/workspace'
import { readSaid } from '@/lib/ai/said-parser'
import { cancelOpenMic, setOpenMicDump, startOpenMic, useOpenMicStore, type AdoptedSession, type OpenMicClient } from '@/lib/ai/open-mic'
import { t } from '../../shared/i18n'
import { announce } from '@/stores/announcer-store'
import { useVoiceStore } from '@/stores/voice-store'

// Smart dictation (docs/ai-assistant-v1.md section 4): the transcript, one request, the checks,
// and the draft cards the user changes and adds (DictationHost draws them and adds them). Spoken,
// it keeps the microphone open (3.7): the first turn is the dictation request, each later turn an
// edit of the cards (4.4), and talking again cancels a request still running so its words go out
// with the new ones. Also "Make tasks from this" (text from outside) and "Break into steps" (a
// task's notes, the answer's tasks become its subtasks). A failed request keeps the transcript on
// the device until it is added or discarded (4.6).
//
// With the sheet's Brain dump switch on (4.8), a turn is not sent: its words are added to the dump,
// which the person can also type into, until Organize sends it whole. The plan that comes back can
// add new projects; what is said or typed after it waits in a field until Update sends it as an
// edit (4.8.4). The switch is offered while nothing has been sent and is remembered on the device.

/**
 * A card's draft: a brain dump's may go in a new project of the plan (`project_ref`); dictation's
 * never do. A card of notes (4.9) also has who it is for and the line it came from.
 */
export type CardDraft = BrainDumpDraft & Partial<Pick<NotesDraft, 'owner' | 'page' | 'from'>>

/** What the person chose on a card of notes (4.9.9); unset parts follow the defaults and the filter. */
export interface NotesChoice {
  ticked?: boolean
  action?: OwnerAction
}

/** The plan of notes (4.9) under review: what the notes screen handed over, and the choices made. */
export interface NotesMode {
  title: string
  /** The notes' date, `YYYY-MM-DD`. */
  date: string
  /** How many batches the plan came from (Update needs one, 4.9.8). */
  batches: number
  /** The transcript's pages, for an Update. */
  pages: NotesPage[]
  /** The context JSON the plan was made with (4.9.4), for an Update. */
  contextJson: string
  me: string | null
  decisions: NotesDecisionAnswer[]
  questions: NotesQuestionAnswer[]
  /** Drafts left out as repeats, or over the limit (4.9.7). */
  repeated: number
  overLimit: number
  filter: NotesFilter
  /** "Agreed in the meeting" (4.9.9). */
  agreed: boolean
  choices: Record<string, NotesChoice>
}

export interface DraftCard {
  draft: CardDraft
  /** Fields an edit by voice changed (highlighted). */
  changed: DraftField[]
  /** Fields the checks left empty, with what the model said (explained on the card). */
  dropped: DroppedField[]
}

/** `live`: the panel is open and listening, nothing has been sent yet. */
export type DictationPhase = 'idle' | 'live' | 'requesting' | 'cards' | 'failed' | 'empty' | 'adding'

export interface DictationParent {
  id: number
  title: string
  project_id: number
}

export type DictationSource = 'voice' | 'text' | 'steps' | 'notes'

interface DictationState {
  phase: DictationPhase
  source: DictationSource
  transcript: string
  /** When the recording ended, local `YYYY-MM-DDTHH:mm:ss`. */
  reference: string
  list: ListInfo | null
  parent: DictationParent | null
  cards: DraftCard[]
  unclear: string[]
  error: string | null
  /** The kept transcript (4.6) this panel shows, if any. */
  keptId: string | null
  /** An edit by voice (a brain dump's Update): its request while it runs, or why it failed. */
  edit: { phase: 'idle' | 'requesting'; words: string; error: string | null }
  /** A request went out from this sheet: the Brain dump switch is no longer offered (4.8). */
  sent: boolean
  /** The Brain dump switch (4.8): turns go to the dump, and Organize sends it. */
  brainDump: boolean
  /** The dump: what was said and typed before Organize (kept for Edit and for going back). */
  dump: string
  /** The dump or the Update field reached `transcript_max_chars`, so the microphone turned off. */
  dumpFull: boolean
  /** The plan's new projects (4.8.5). */
  projects: CheckedProject[]
  /** New projects an Update added or changed (highlighted). */
  changedProjects: string[]
  /** What the checks left out of the plan's new projects (4.8.3), in words. */
  projectNotes: string[]
  /** What was said or typed after the plan, waiting for Update (4.8.4). */
  more: string
  /** Why Add stopped: no connection for new projects, or a project that could not be created. */
  addError: string | null
  /** A plan of notes (4.9) under review, or null. */
  notes: NotesMode | null
  /** Opens the plan the notes screen made (4.9.3), to review and add. */
  openNotesPlan: (input: {
    plan: NotesPlan
    reference: string
    list: ListInfo | null
    mode: Omit<NotesMode, 'decisions' | 'questions' | 'repeated' | 'overLimit' | 'filter' | 'agreed' | 'choices'> & Partial<Pick<NotesMode, 'filter' | 'agreed' | 'choices'>>
  }) => void
  setNotesFilter: (filter: NotesFilter) => void
  setNotesAgreed: (agreed: boolean) => void
  setNotesChoice: (ref: string, choice: NotesChoice) => void
  open: (input: { transcript: string; list: ListInfo | null; source: DictationSource; parent?: DictationParent | null; reference?: string; keptId?: string | null }) => void
  /**
   * Spoken smart dictation: opens the panel listening (or keeps the one open) with the microphone
   * on. `adopt` takes over a quick capture that was locked, with the words it heard.
   */
  startLive: (input?: { list?: ListInfo | null; adopt?: AdoptedSession; brainDump?: boolean }) => void
  /** Turns the microphone on in the open panel. */
  listen: () => void
  retry: () => void
  editByVoice: (instruction: string) => Promise<void>
  /** Stops the request that is running (its answer is ignored): back to listening, or the cards as they were. */
  cancelRequest: () => void
  updateDraft: (ref: string, change: Partial<CardDraft>) => void
  removeDraft: (ref: string) => void
  /** The Brain dump switch, while nothing has been sent; remembered on the device. */
  setBrainDump: (on: boolean) => void
  setDump: (text: string) => void
  /** Sends the whole dump (4.8.1). */
  organize: () => void
  setMore: (text: string) => void
  /** Sends what waits in the Update field as an edit of the plan (4.8.4). */
  update: () => Promise<void>
  /** A failed or empty brain dump: back to the dump to change or extend it. */
  editDump: () => void
  renameProject: (ref: string, title: string) => void
  /** Removes a new project; its tasks and subprojects move to its parent (4.8.5). */
  removeProject: (ref: string) => void
  /** Add made the projects but not every task: the drafts now name those projects by id. */
  projectsCreated: (projectIds: Record<string, number>) => void
  setAddError: (message: string | null) => void
  setPhase: (phase: DictationPhase) => void
  /** Closes the panel; a kept transcript is dropped (`discard`) or stays for later. */
  close: (options?: { discard?: boolean }) => void
}

export interface DictationDeps {
  workspace: () => AiWorkspace
  /** The locale slash dates are read with. */
  locale: () => string
  /** The list on screen, whose defaults new tasks get. */
  list: () => ListInfo | null
  /** The Brain dump switch as last set in the sheet (a device setting). */
  brainDump: () => boolean
  rememberBrainDump: (on: boolean) => void
}

let deps: DictationDeps | null = null
let requestCounter = 0
/** The request whose answer is waited for; a cancelled or replaced one is ignored when it comes. */
let activeRequest: string | null = null

/** Set by DictationHost, which knows the window's caches. */
export function setDictationDeps(next: DictationDeps | null): void {
  deps = next
}

export function errorText(error: AiError): string {
  switch (error.kind) {
    case 'timeout': return 'The model did not answer in time.'
    case 'network': return 'Could not reach the model.'
    case 'auth': return 'The provider refused the key.'
    case 'bad_answer': return 'The model’s answer could not be used.'
    default: return error.message || 'The request failed.'
  }
}

const EMPTY_EDIT = { phase: 'idle' as const, words: '', error: null }

/** No brain dump: the state a closed or a plain dictation sheet starts from. */
const NO_DUMP = { brainDump: false, dump: '', dumpFull: false, projects: [], changedProjects: [], projectNotes: [], more: '', addError: null, notes: null }

/** The fields a brain dump's checks report for its projects (4.8.3). */
const PROJECT_DROPS = new Set(['project', 'project_title', 'parent'])

/** The plan's notes for what the checks left out of its new projects (4.8.3), as the phone words them. */
function projectNotesOf(dropped: readonly DroppedField[], projects: readonly CheckedProject[]): string[] {
  return dropped.filter((d) => PROJECT_DROPS.has(d.field)).map((d) => {
    if (d.field === 'project') return `More than ${AI_LIMITS.brain_dump_projects_max} new projects: the rest were left out`
    if (d.field === 'project_title') return 'Skipped a new project without a name'
    const title = projects.find((p) => p.ref === d.ref)?.title
    return title ? `“${title}”: its parent project was not found, so it goes at the top level` : 'A parent project was not found, so a new project goes at the top level'
  })
}

/** A dictation draft as a card's draft (it never goes in a new project). */
function cardDraftOf(draft: CheckedDraft): CardDraft {
  return { ...draft, project_ref: null }
}

/** At the dump's limit the microphone turns off (4.8); after the turn being handled, not inside it. */
function stopMicAtLimit(): void {
  setTimeout(() => {
    if (useOpenMicStore.getState().owner === 'dictation') cancelOpenMic()
  }, 0)
  announce('That is as long as it can be, so the microphone turned off.')
}

/** "2 new projects and 14 tasks" for the announcement of a plan. */
function planSummary(projects: number, tasks: number): string {
  const taskText = tasks === 1 ? '1 task' : `${tasks} tasks`
  if (projects === 0) return taskText
  return `${projects === 1 ? '1 new project' : `${projects} new projects`} and ${taskText}`
}

export const useDictationStore = create<DictationState>((set, get) => {
  async function run(edit: string | null): Promise<void> {
    if (!deps) return
    const ws = deps.workspace()
    const state = get()
    const dumping = state.brainDump
    const id = `dictation-${Date.now()}-${++requestCounter}`
    activeRequest = id
    if (!state.sent) set({ sent: true })
    const contextJson = dictationContextFor(ws, state.list, state.reference)
    const placeName = (placeId: string) => ws.places.find((p) => p.id === placeId)?.name ?? null
    const drafts = state.cards.map((card) => card.draft)
    const notes = state.notes
    const user = notes && edit !== null
      ? notesUserMessage(notes.contextJson, notes.pages, { plan: notesPlanAsAnswer(state.projects, drafts.map(asNotesDraft), placeName), words: edit })
      : dumping
        ? brainDumpUserMessage(contextJson, edit ?? state.transcript, edit !== null ? planAsAnswer(state.projects, drafts, placeName) : undefined)
        : dictationUserMessage(contextJson, edit ?? state.transcript, edit !== null ? draftsAsAnswer(drafts, placeName) : undefined)
    const result = await window.api.ai.dictate({ requestId: id, edit: edit !== null, user, ...(notes ? { notes: true } : dumping ? { brainDump: true } : {}) })
    // Closed, cancelled by talking on, or replaced while it ran.
    if (activeRequest !== id) return
    activeRequest = null
    const now = get()
    if (now.phase === 'idle') return

    if (!result.success) {
      if (edit !== null) {
        // A brain dump's words go back to the Update field, before anything said since.
        if (dumping) set({ edit: { phase: 'idle', words: edit, error: errorText(result.error) }, more: appendToDump(edit, now.more).text })
        else set({ edit: { phase: 'idle', words: edit, error: errorText(result.error) } })
        return
      }
      const keptId = now.keptId ?? id
      // Words said while Organize ran belong to the dump.
      const transcript = dumping && now.more.trim() ? appendToDump(now.transcript, now.more).text : now.transcript
      const kept: KeptTranscript = {
        id: keptId,
        transcript,
        reference: now.reference,
        error: errorText(result.error),
        list: now.list ? { name: now.list.name, projectId: now.list.projectId, defaultDue: now.list.defaultDue } : null,
        parentTaskId: now.parent?.id ?? null,
        ...(dumping ? { brainDump: true } : {}),
      }
      void window.api.ai.keepTranscript(kept)
      set({ phase: 'failed', error: kept.error, keptId, ...(dumping ? { transcript, dump: transcript, more: '' } : {}) })
      announce(dumping ? 'The dump could not be organized. It is kept.' : 'The tasks could not be made. The transcript is kept.')
      return
    }

    const context = {
      reference: now.reference,
      defaultDue: now.list?.defaultDue ?? null,
      projects: contextProjects(ws),
      default_project_id: defaultProjectFor(ws, now.list),
      labels: ws.labels,
      places: ws.places,
      readSaid: (said: string) => readSaid(said, now.reference, deps?.locale()),
    }
    const checked = notes
      ? (() => {
          // An Update of notes (4.9.8): one batch, numbered from the start; the owners' choices go
          // back to their defaults.
          const answer = checkNotesAnswer(result.data as NotesAnswer, context, { pages: notes.pages, me: notes.me })
          set({ notes: { ...notes, decisions: answer.decisions, questions: answer.questions, choices: {} } })
          return answer
        })()
      : dumping
      ? checkBrainDumpAnswer(result.data as BrainDumpAnswer, context)
      : (() => {
          const answer = checkDictationAnswer(result.data as DictationAnswer, context)
          return { ...answer, drafts: answer.drafts.map(cardDraftOf), projects: [] as CheckedProject[] }
        })()
    const previous = new Map(now.cards.map((card) => [card.draft.ref, card.draft]))
    const cards = checked.drafts.map((draft): DraftCard => {
      const before = edit !== null ? previous.get(draft.ref) : undefined
      let next = draft
      if (before) {
        // A due date or project the edit left alone keeps how sure it was.
        const guessed = new Set(draft.guessed)
        if (before.due === draft.due) {
          if (before.guessed.includes('when')) guessed.add('when')
          else guessed.delete('when')
        }
        if (before.project_id === draft.project_id && before.project_ref === draft.project_ref) {
          if (before.guessed.includes('project')) guessed.add('project')
          else guessed.delete('project')
        }
        next = { ...draft, guessed: DICTATION_FIELDS.filter((field) => guessed.has(field)) }
      }
      return {
        draft: next,
        changed: edit !== null ? (before ? changedFields(before, next) : ['title']) : [],
        // A brain dump's project entries (`project`, `project_title`, `parent`) are not a card's.
        dropped: checked.dropped.filter((d) => d.ref === draft.ref && !PROJECT_DROPS.has(d.field)),
      }
    })
    if (cards.length === 0 && checked.projects.length === 0) {
      set({ phase: 'empty', cards: [], projects: [], unclear: checked.unclear, error: null, edit: EMPTY_EDIT })
      announce('Nothing to add')
      return
    }
    // The kept transcript has served its purpose once there are cards.
    if (now.keptId) void window.api.ai.dropKeptTranscript(now.keptId)
    set({
      phase: 'cards',
      cards,
      projects: checked.projects,
      changedProjects: edit !== null ? changedProjects(now.projects, checked.projects) : [],
      projectNotes: projectNotesOf(checked.dropped, checked.projects),
      unclear: checked.unclear,
      error: null,
      keptId: null,
      edit: EMPTY_EDIT,
      addError: null,
    })
    announce(dumping ? `${planSummary(checked.projects.length, cards.length)} to check` : cards.length === 1 ? '1 task to check' : `${cards.length} tasks to check`)
  }

  /** A brain dump's turn: added to the dump, or after Organize to the Update field; never sent. */
  function heardInDump(text: string): void {
    const state = get()
    if (state.phase === 'live') {
      const { text: dump, full } = appendToDump(state.dump, text)
      set({ dump, dumpFull: full })
      if (full) stopMicAtLimit()
    } else if (state.phase === 'requesting' || state.phase === 'cards') {
      const { text: more, full } = appendToDump(state.more, text)
      set({ more, dumpFull: full })
      if (full) stopMicAtLimit()
    } else if (state.phase === 'failed' || state.phase === 'empty') {
      // Talking on after a failure goes on with the dump.
      const { text: dump, full } = appendToDump(state.transcript, text)
      set({ phase: 'live', dump, dumpFull: full, transcript: '', error: null, unclear: [] })
      if (full) stopMicAtLimit()
    }
  }

  /** Nothing left of the plan: back to the dump, as it was before Organize. */
  function backToDump(): void {
    set({ phase: 'live', cards: [], projects: [], changedProjects: [], projectNotes: [], transcript: '', unclear: [], more: '', addError: null })
  }

  /** A turn's words to the model: the dictation request, or an edit once there are cards. */
  const client: OpenMicClient = {
    onTurn: async (text) => {
      const state = get()
      if (state.brainDump) return heardInDump(text)
      if (state.phase === 'cards') return get().editByVoice(text)
      if (state.phase === 'adding' || state.phase === 'idle') return
      // Nothing made yet: the request again, with what was said before a failure, an empty answer,
      // or a Retry still running.
      if (state.phase === 'requesting' && activeRequest) void window.api.ai.cancelDictation(activeRequest)
      const transcript = state.phase === 'live' ? text : joinWords(state.transcript, text)
      set({ phase: 'requesting', transcript, reference: localDateTimeOf(new Date()), unclear: [], error: null })
      await run(null)
    },
    onInterrupt: () => get().cancelRequest(),
    onOff: () => {
      // Turned off before anything was said: nothing to show. A brain dump stays open to type into.
      if (get().phase === 'live' && !get().brainDump) get().close()
    },
  }

  return {
    phase: 'idle',
    source: 'voice',
    transcript: '',
    reference: '',
    list: null,
    parent: null,
    cards: [],
    unclear: [],
    error: null,
    keptId: null,
    edit: EMPTY_EDIT,
    sent: false,
    ...NO_DUMP,

    open: ({ transcript, list, source, parent = null, reference, keptId = null }) => {
      set({
        ...NO_DUMP,
        phase: 'requesting',
        source,
        transcript,
        reference: reference ?? localDateTimeOf(new Date()),
        list,
        parent,
        cards: [],
        unclear: [],
        error: null,
        keptId,
        edit: EMPTY_EDIT,
      })
      void run(null)
    },

    startLive: (input = {}) => {
      const state = get()
      if (state.phase === 'idle') {
        set({
          ...NO_DUMP,
          brainDump: input.brainDump ?? deps?.brainDump() ?? false,
          sent: false,
          phase: 'live',
          source: 'voice',
          transcript: '',
          reference: localDateTimeOf(new Date()),
          list: input.list !== undefined ? input.list : deps?.list() ?? null,
          parent: null,
          cards: [],
          unclear: [],
          error: null,
          keptId: null,
          edit: EMPTY_EDIT,
        })
      } else if (input.brainDump === true && !state.brainDump && state.phase === 'live' && state.source === 'voice' && !state.sent) {
        // Brain dump asked for over a sheet that has sent nothing yet.
        set({ brainDump: true })
      }
      // A quick capture still running gives way, unless it is the one handed over.
      if (!input.adopt) useVoiceStore.getState().cancel()
      startOpenMic('dictation', client, input.adopt, { dump: get().brainDump })
      announce(get().brainDump
        ? 'Listening. Talk as long as you like; nothing is sent until you choose Organize.'
        : 'Listening. Say your tasks; pause and they appear as cards.')
    },

    listen: () => {
      if (get().phase === 'idle' || useOpenMicStore.getState().owner === 'dictation') return
      useVoiceStore.getState().cancel()
      set({ dumpFull: false })
      startOpenMic('dictation', client, undefined, { dump: get().brainDump })
    },

    retry: () => {
      if (get().phase !== 'failed' && get().phase !== 'empty') return
      set({ phase: 'requesting', error: null })
      void run(null)
    },

    cancelRequest: () => {
      const id = activeRequest
      if (!id) return
      activeRequest = null
      void window.api.ai.cancelDictation(id)
      const state = get()
      if (state.brainDump) {
        // Nothing of a brain dump is lost: Organize goes back to the dump (with what was said since),
        // an Update's words back to its field.
        if (state.phase === 'requesting') set({ phase: 'live', transcript: '', dump: appendToDump(state.dump, state.more).text, more: '' })
        else if (state.edit.phase === 'requesting') set({ edit: EMPTY_EDIT, more: appendToDump(state.edit.words, state.more).text })
        return
      }
      if (state.phase === 'requesting') set({ phase: 'live', transcript: '' })
      else set({ edit: EMPTY_EDIT })
    },

    editByVoice: async (instruction) => {
      const words = instruction.trim()
      if (!words || get().phase !== 'cards') {
        set({ edit: EMPTY_EDIT })
        return
      }
      set({ edit: { phase: 'requesting', words, error: null } })
      await run(words)
    },

    updateDraft: (ref, change) => set((state) => ({
      cards: state.cards.map((card) => card.draft.ref === ref
        ? {
            ...card,
            draft: { ...card.draft, ...change, guessed: card.draft.guessed.filter((field) => !touched(change).includes(field)) },
            dropped: card.dropped.filter((d) => !touched(change).includes(d.field as DraftField)),
          }
        : card),
    })),

    removeDraft: (ref) => {
      const state = get()
      const cards = state.cards.filter((card) => card.draft.ref !== ref)
      if (cards.length > 0 || (state.brainDump && state.projects.length > 0)) set({ cards })
      else if (state.brainDump) backToDump()
      // Still listening: the next words start over.
      else if (useOpenMicStore.getState().owner === 'dictation') set({ cards, phase: 'live', transcript: '', unclear: [] })
      else get().close()
    },

    setBrainDump: (on) => {
      const state = get()
      if (state.phase !== 'live' || state.source !== 'voice' || state.sent || state.brainDump === on) return
      deps?.rememberBrainDump(on)
      if (useOpenMicStore.getState().owner === 'dictation') setOpenMicDump(on)
      const dumped = state.dump.trim()
      if (!on && dumped) {
        // What was dumped so far goes out as smart dictation's first turn would have.
        set({ ...NO_DUMP, phase: 'requesting', transcript: dumped, reference: localDateTimeOf(new Date()), unclear: [], error: null })
        void run(null)
        return
      }
      set({ brainDump: on, dumpFull: false })
      announce(on ? 'Brain dump on. Nothing is sent until you choose Organize.' : 'Brain dump off. Each pause turns what you said into task cards.')
    },

    setDump: (text) => {
      const dump = text.slice(0, AI_LIMITS.transcript_max_chars)
      const full = dump.length >= AI_LIMITS.transcript_max_chars
      set({ dump, dumpFull: full })
      if (full && useOpenMicStore.getState().owner === 'dictation') stopMicAtLimit()
    },

    organize: () => {
      const state = get()
      const dumped = state.dump.trim()
      if (!state.brainDump || state.phase !== 'live' || !dumped) return
      set({ phase: 'requesting', transcript: dumped, reference: localDateTimeOf(new Date()), unclear: [], error: null, more: '', addError: null })
      void run(null)
    },

    setMore: (text) => {
      const more = text.slice(0, AI_LIMITS.transcript_max_chars)
      const full = more.length >= AI_LIMITS.transcript_max_chars
      set({ more, dumpFull: full })
      if (full && useOpenMicStore.getState().owner === 'dictation') stopMicAtLimit()
    },

    update: async () => {
      const state = get()
      const words = state.more.trim()
      if (!state.brainDump || state.phase !== 'cards' || !words || state.edit.phase === 'requesting') return
      set({ more: '', edit: { phase: 'requesting', words, error: null }, addError: null, dumpFull: false })
      await run(words)
    },

    editDump: () => {
      const state = get()
      if (!state.brainDump || (state.phase !== 'failed' && state.phase !== 'empty')) return
      set({ phase: 'live', dump: state.transcript, transcript: '', error: null, unclear: [] })
    },

    renameProject: (ref, title) => set((state) => ({
      projects: state.projects.map((project) => (project.ref === ref ? { ...project, title } : project)),
    })),

    removeProject: (ref) => {
      const state = get()
      const ws = deps?.workspace()
      const defaultProjectId = ws ? defaultProjectFor(ws, state.list) : state.cards[0]?.draft.project_id ?? 0
      const plan = removePlanProject(ref, state.projects, state.cards.map((card) => card.draft), defaultProjectId)
      const moved = new Map(plan.drafts.map((draft) => [draft.ref, draft]))
      const cards = state.cards.map((card) => {
        const draft = moved.get(card.draft.ref) ?? card.draft
        return draft === card.draft ? card : { ...card, draft, changed: [...new Set<DraftField>([...card.changed, 'project'])] }
      })
      if (cards.length === 0 && plan.projects.length === 0) {
        backToDump()
        return
      }
      set({ projects: plan.projects, changedProjects: state.changedProjects.filter((r) => r !== ref), cards })
    },

    projectsCreated: (projectIds) => set((state) => ({
      projects: [],
      changedProjects: [],
      projectNotes: [],
      cards: state.cards.map((card) => {
        const ref = card.draft.project_ref
        const id = ref !== null ? projectIds[ref] : undefined
        return id !== undefined ? { ...card, draft: { ...card.draft, project_id: id, project_ref: null } } : card
      }),
    })),

    setAddError: (message) => set({ addError: message }),

    openNotesPlan: ({ plan, reference, list, mode }) => {
      if (activeRequest) void window.api.ai.cancelDictation(activeRequest)
      activeRequest = null
      if (useOpenMicStore.getState().owner === 'dictation') cancelOpenMic()
      set({
        ...NO_DUMP,
        phase: 'cards',
        source: 'notes',
        brainDump: true,
        sent: true,
        transcript: '',
        reference,
        list,
        parent: null,
        cards: plan.drafts.map((draft): DraftCard => ({ draft, changed: [], dropped: plan.dropped.filter((d) => d.ref !== '' && d.ref === draft.ref) })),
        projects: plan.projects,
        projectNotes: projectNotesOf(plan.dropped, plan.projects),
        unclear: plan.unclear,
        error: null,
        keptId: null,
        edit: EMPTY_EDIT,
        notes: {
          ...mode,
          decisions: plan.decisions,
          questions: plan.questions,
          repeated: plan.dropped.filter((d) => d.field === 'duplicate').length,
          overLimit: plan.dropped.filter((d) => d.field === 'task' && d.ref === '').length,
          filter: mode.filter ?? 'mine_and_waiting',
          agreed: mode.agreed ?? false,
          choices: mode.choices ?? {},
        },
      })
      announce(t('notes.plan.ready', { count: plan.drafts.length }))
    },

    setNotesFilter: (filter) => set((state) => (state.notes
      // A filter sets every card's tick again (4.9.9).
      ? { notes: { ...state.notes, filter, choices: Object.fromEntries(Object.entries(state.notes.choices).map(([ref, choice]) => [ref, { action: choice.action }])) } }
      : {})),

    setNotesAgreed: (agreed) => set((state) => (state.notes ? { notes: { ...state.notes, agreed } } : {})),

    setNotesChoice: (ref, choice) => set((state) => (state.notes
      ? { notes: { ...state.notes, choices: { ...state.notes.choices, [ref]: { ...state.notes.choices[ref], ...choice } } } }
      : {})),

    setPhase: (phase) => set({ phase }),

    close: (options) => {
      const { keptId } = get()
      if (activeRequest) void window.api.ai.cancelDictation(activeRequest)
      activeRequest = null
      if (options?.discard && keptId) void window.api.ai.dropKeptTranscript(keptId)
      set({ phase: 'idle', cards: [], unclear: [], error: null, transcript: '', keptId: null, edit: EMPTY_EDIT, parent: null, sent: false, ...NO_DUMP })
      if (useOpenMicStore.getState().owner === 'dictation') cancelOpenMic()
    },
  }
})

/** A card of notes as a checked notes draft (a card made otherwise has none of the three). */
function asNotesDraft(draft: CardDraft): NotesDraft {
  return { ...draft, owner: draft.owner ?? null, page: draft.page ?? null, from: draft.from ?? null }
}

/** The draft fields a hand edit touched (they are no longer guessed). */
function touched(change: Partial<CardDraft>): DraftField[] {
  const fields: DraftField[] = []
  if ('title' in change) fields.push('title')
  if ('notes' in change) fields.push('notes')
  if ('due' in change) fields.push('when')
  if ('project_id' in change || 'project_ref' in change) fields.push('project')
  if ('labels' in change) fields.push('labels')
  if ('priority' in change) fields.push('priority')
  if ('repeat' in change) fields.push('repeat')
  if ('reminder' in change) fields.push('reminder')
  if ('place' in change) fields.push('place')
  if ('subtasks' in change) fields.push('subtasks')
  return fields
}

/** A dictation panel is on screen. */
export function isDictationOpen(): boolean {
  return useDictationStore.getState().phase !== 'idle'
}
