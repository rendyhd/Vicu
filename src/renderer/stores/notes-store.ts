import { create } from 'zustand'
import { AI_LIMITS } from '../../shared/ai/contract'
import {
  EMPTY_NOTES_PLAN,
  checkNotesAnswer,
  knownProjects,
  mergeNotesBatch,
  notesBatches,
  notesContextJson,
  notesUserMessage,
  type NotesAnswer,
  type NotesPage,
  type NotesPlan,
} from '../../shared/ai/notes'
import { hasImagesConsent, imagesConsentKey, consentKey, readingModel } from '../../shared/ai/settings'
import type { AiSettingsView } from '../../shared/ai/types'
import type { NotesFile } from '../../shared/notes-import-types'
import { t } from '../../shared/i18n'
import { contextProjects, defaultProjectFor, pathOf, timeZone, type AiWorkspace, type ListInfo } from '@/lib/ai/workspace'
import { readSaid } from '@/lib/ai/said-parser'
import {
  imagePage,
  movedPage,
  pagesFromFile,
  textPage,
  transcriptPages,
  unreadPages,
  withPdfMode,
  type NotesFileIssue,
  type NotesSourcePage,
} from '@/lib/notes/pages'
import { prepareImage } from '@/lib/notes/images'
import { errorText, useDictationStore, type NotesMode } from '@/stores/dictation-store'
import { announce } from '@/stores/announcer-store'
import { toLocalDate } from '@/lib/due-dates'

// Notes to tasks (docs/ai-assistant-v1.md section 4.9): the notes screen's state. Sources become
// pages (lib/notes/pages.ts); pictures are read by the reading model (4.9.1, 4.9.2), a few at a time;
// Organize sends the transcript in batches (4.9.3) and hands the checked plan to the dictation sheet
// (stores/dictation-store.ts, `openNotesPlan`), where it is reviewed and added like a brain dump.
// The notes are kept on the device (main's notes-import.json) until they are added or discarded.

export type NotesBusy =
  | { kind: 'adding' }
  | { kind: 'testing'; model: string }
  | { kind: 'reading'; done: number; total: number }
  | { kind: 'organizing'; batch: number; total: number }

export type NotesProblem =
  | { kind: 'consent' }
  | { kind: 'no-reader' }
  | { kind: 'nothing' }
  | { kind: 'organize'; batch: number; total: number; message: string }

/** What stays on the device while the notes are open (4.9.11). */
export interface NotesSession {
  version: 1
  title: string
  date: string
  pages: NotesSourcePage[]
  /** The plan under review in the dictation sheet, when there is one. */
  plan?: { plan: NotesPlan; mode: NotesMode; reference: string; list: ListInfo | null }
}

interface Partial {
  plan: NotesPlan
  batches: NotesPage[][]
  next: number
  nextDraft: number
  contextJson: string
  reference: string
  me: string | null
}

interface NotesState {
  open: boolean
  title: string
  /** `YYYY-MM-DD`. */
  date: string
  /** The date was set by hand: a file's date no longer replaces it. */
  dateSet: boolean
  pages: NotesSourcePage[]
  issues: NotesFileIssue[]
  /** Pages beyond `notes_pages_max` were left out. */
  overLimit: boolean
  busy: NotesBusy | null
  problem: NotesProblem | null
  /** The model reading pictures, once known. */
  reader: string | null
  /** Notes kept from an earlier run of the app, not opened yet. */
  waiting: boolean
  partial: Partial | null

  openNotes: (input?: { text?: string; files?: NotesFile[] }) => void
  close: () => void
  setTitle: (title: string) => void
  setDate: (date: string) => void
  addFiles: (files: readonly NotesFile[]) => Promise<void>
  addText: (text: string, source?: string) => void
  addPicture: (blob: Blob, source?: string) => Promise<void>
  setPageText: (id: string, text: string) => void
  removePage: (id: string) => void
  movePage: (id: string, delta: -1 | 1) => void
  setReadAsImage: (id: string, on: boolean) => void
  readPages: (ids?: string[]) => Promise<void>
  agreeToImages: () => Promise<void>
  dismissProblem: () => void
  organize: () => Promise<void>
  /** A batch failed: review what was organized before it. */
  reviewSoFar: () => void
  cancel: () => void
  /** Drops the notes, their pages and any plan (4.9.11). */
  discard: () => void
  /** The plan was added: the notes are done. */
  finished: () => void
  /** Back from the plan to the pages. */
  backToPages: () => void
  /** At start: notes kept from an earlier run. */
  restore: () => Promise<void>
  /** Opens what `restore` found: the plan when there was one, else the pages. */
  openWaiting: () => void
}

export interface NotesDeps {
  workspace: () => AiWorkspace
  list: () => ListInfo | null
  locale: () => string
  /** The account's name. */
  me: () => string | null
  /** Names the person knows (4.9.4). */
  people: () => string[]
  settings: () => Promise<AiSettingsView>
  saveConsent: (keys: string[]) => Promise<void>
}

let deps: NotesDeps | null = null
let keptPlan: NotesSession['plan'] | undefined
let run = 0
const requests = new Set<string>()

export function setNotesDeps(next: NotesDeps | null): void {
  deps = next
}

const today = () => toLocalDate(new Date())

const CLOSED = {
  open: false,
  title: '',
  date: '',
  dateSet: false,
  pages: [] as NotesSourcePage[],
  issues: [] as NotesFileIssue[],
  overLimit: false,
  busy: null,
  problem: null,
  reader: null,
  waiting: false,
  partial: null,
}

function cancelRequests(): void {
  run += 1
  for (const id of requests) void window.api.ai.cancelDictation(id)
  requests.clear()
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Writes the notes to the device (debounced); nothing when there is nothing. */
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const state = useNotesStore.getState()
    if (state.pages.length === 0 && !keptPlan) {
      void window.api.notes.clearSession()
      return
    }
    const session: NotesSession = { version: 1, title: state.title, date: state.date || today(), pages: state.pages, ...(keptPlan ? { plan: keptPlan } : {}) }
    void window.api.notes.saveSession(session)
  }, 400)
}

/** The plan in the dictation sheet is kept with the notes while it is reviewed. */
export function keepNotesPlan(plan: NotesSession['plan'] | undefined): void {
  keptPlan = plan
  scheduleSave()
}

function isSession(value: unknown): value is NotesSession {
  const o = value as NotesSession | null
  return !!o && o.version === 1 && Array.isArray(o.pages) && typeof o.date === 'string'
}

export const useNotesStore = create<NotesState>((set, get) => {
  const fileDate = (files: readonly NotesFile[]) => {
    if (get().dateSet || get().pages.length > 0) return
    const first = files.find((file) => typeof file.modified === 'number' && !file.problem)
    if (first?.modified) set({ date: toLocalDate(new Date(first.modified)) })
  }

  const withPages = (add: NotesSourcePage[]) => {
    const room = AI_LIMITS.notes_pages_max - get().pages.length
    set({ pages: [...get().pages, ...add.slice(0, Math.max(0, room))], overLimit: add.length > room || get().overLimit, problem: null })
    scheduleSave()
  }

  const updatePage = (id: string, change: (page: NotesSourcePage) => NotesSourcePage) => {
    set({ pages: get().pages.map((page) => (page.id === id ? change(page) : page)) })
    scheduleSave()
  }

  return {
    ...CLOSED,

    openNotes: (input = {}) => {
      const state = get()
      if (!state.open) set({ open: true, waiting: false, date: state.date || today() })
      if (input.text?.trim()) get().addText(input.text, t('notes.typedText'))
      if (input.files?.length) void get().addFiles(input.files)
    },

    close: () => {
      cancelRequests()
      set({ open: false, busy: null })
    },

    setTitle: (title) => {
      set({ title })
      scheduleSave()
    },

    setDate: (date) => {
      set({ date, dateSet: true })
      scheduleSave()
    },

    addFiles: async (files) => {
      fileDate(files)
      set({ busy: { kind: 'adding' }, issues: [] })
      const issues: NotesFileIssue[] = []
      for (const file of files) {
        const result = await pagesFromFile(file)
        if (result.issue) issues.push(result.issue)
        if (result.more) issues.push({ name: file.name, problem: 'more' })
        withPages(result.pages)
      }
      set({ busy: null, issues })
    },

    addText: (text, source = '') => {
      if (!text.trim()) return
      withPages([textPage(text, source)])
    },

    addPicture: async (blob, source = '') => {
      try {
        const prepared = await prepareImage(blob)
        withPages([imagePage(prepared.data, source)])
      } catch {
        set({ issues: [...get().issues, { name: source || t('notes.pastedPicture'), problem: 'image' }] })
      }
    },

    setPageText: (id, text) => updatePage(id, (page) => ({ ...page, text })),

    removePage: (id) => {
      set({ pages: get().pages.filter((page) => page.id !== id) })
      scheduleSave()
    },

    movePage: (id, delta) => {
      set({ pages: movedPage(get().pages, id, delta) })
      scheduleSave()
    },

    setReadAsImage: (id, on) => updatePage(id, (page) => withPdfMode(page, on)),

    readPages: async (ids) => {
      if (!deps || get().busy) return
      const mine = ++run
      let settings = await deps.settings()
      if (!hasImagesConsent(settings)) {
        set({ problem: { kind: 'consent' } })
        return
      }
      // The reading model (4.9.1): a model never asked whether it reads images is asked first.
      let { model, untested } = readingModel(settings)
      for (const candidate of untested) {
        if (model || run !== mine) break
        set({ busy: { kind: 'testing', model: candidate } })
        await window.api.ai.testVision(candidate).catch(() => undefined)
        settings = await deps.settings()
        model = readingModel(settings).model
      }
      if (run !== mine) return
      if (!model) {
        set({ busy: null, problem: { kind: 'no-reader' } })
        return
      }
      set({ reader: model, problem: null })
      const wanted = new Set(ids ?? unreadPages(get().pages).map((page) => page.id))
      const queue = get().pages.filter((page) => wanted.has(page.id) && page.image)
      const total = queue.length
      let done = 0
      set({ busy: { kind: 'reading', done, total } })
      const worker = async () => {
        while (queue.length > 0 && run === mine) {
          const page = queue.shift()!
          const all = get().pages
          const index = all.findIndex((p) => p.id === page.id)
          if (index < 0) continue
          updatePage(page.id, (p) => ({ ...p, status: 'reading', error: undefined }))
          const requestId = `notes-read-${Date.now()}-${page.id}`
          requests.add(requestId)
          const result = await window.api.ai.readPage({
            requestId,
            image: { media_type: 'image/jpeg', data: page.image! },
            page: index + 1,
            pages: all.length,
            title: get().title,
          }).catch((err: unknown) => ({ success: false as const, error: { kind: 'network' as const, message: err instanceof Error ? err.message : '' } }))
          requests.delete(requestId)
          if (run !== mine) return
          if (result.success) updatePage(page.id, (p) => ({ ...p, text: result.data.text, status: 'ready', error: undefined }))
          else updatePage(page.id, (p) => ({ ...p, status: 'failed', error: errorText(result.error) }))
          done += 1
          set({ busy: { kind: 'reading', done, total } })
        }
      }
      await Promise.all(Array.from({ length: Math.min(AI_LIMITS.notes_read_parallel, total) }, worker))
      if (run !== mine) return
      set({ busy: null })
      announce(t('notes.readingProgress', { done, total }))
    },

    agreeToImages: async () => {
      if (!deps) return
      const settings = await deps.settings()
      await deps.saveConsent([consentKey(settings), imagesConsentKey(settings)])
      set({ problem: null })
      await get().readPages()
    },

    dismissProblem: () => set({ problem: null }),

    organize: async () => {
      if (!deps || get().busy) return
      const mine = ++run
      const ws = deps.workspace()
      const list = deps.list()
      const state = get()
      let partial = state.partial
      if (!partial) {
        const pages = transcriptPages(state.pages)
        if (pages.length === 0) return
        const reference = `${state.date || today()}T12:00:00`
        const me = deps.me()
        partial = {
          plan: EMPTY_NOTES_PLAN,
          batches: notesBatches(pages),
          next: 0,
          nextDraft: 1,
          reference,
          me,
          contextJson: notesContextJson({
            now: reference,
            timeZone: timeZone(),
            list: list?.name ?? 'Inbox',
            default_project_id: defaultProjectFor(ws, list),
            projects: contextProjects(ws),
            labels: ws.labels.map((label) => label.title),
            places: ws.places.map((place) => place.name),
            me,
            people: deps.people(),
            title: state.title,
          }),
        }
      }
      const context = {
        reference: partial.reference,
        defaultDue: null,
        projects: contextProjects(ws),
        default_project_id: defaultProjectFor(ws, list),
        labels: ws.labels,
        places: ws.places,
        readSaid: (said: string) => readSaid(said, partial!.reference, deps?.locale()),
      }
      let { plan, nextDraft } = partial
      const total = partial.batches.length
      for (let i = partial.next; i < total; i++) {
        set({ busy: { kind: 'organizing', batch: i + 1, total }, problem: null })
        const known = knownProjects(plan, (id) => pathOf(ws, id))
        const user = notesUserMessage(partial.contextJson, partial.batches[i], { soFar: known })
        const requestId = `notes-organize-${Date.now()}-${i}`
        requests.add(requestId)
        const result = await window.api.ai.dictate({ requestId, edit: false, user, notes: true })
          .catch((err: unknown) => ({ success: false as const, error: { kind: 'network' as const, message: err instanceof Error ? err.message : '' } }))
        requests.delete(requestId)
        if (run !== mine) return
        if (!result.success) {
          set({ busy: null, partial: { ...partial, plan, nextDraft, next: i }, problem: { kind: 'organize', batch: i + 1, total, message: errorText(result.error) } })
          return
        }
        const checked = checkNotesAnswer(result.data as NotesAnswer, context, {
          pages: partial.batches[i],
          me: partial.me,
          known,
          firstProjectNumber: plan.projects.length + 1,
          firstDraftNumber: nextDraft,
        })
        nextDraft += checked.drafts.length
        plan = mergeNotesBatch(plan, checked)
      }
      set({ busy: null, partial: null })
      if (plan.drafts.length === 0 && plan.projects.length === 0) {
        set({ problem: { kind: 'nothing' } })
        return
      }
      handOff(plan, total, partial)
    },

    reviewSoFar: () => {
      const partial = get().partial
      if (!partial || partial.plan.drafts.length === 0) return
      set({ partial: null, problem: null })
      handOff(partial.plan, partial.batches.length, partial)
    },

    cancel: () => {
      cancelRequests()
      set({
        busy: null,
        pages: get().pages.map((page) => (page.status === 'reading' ? { ...page, status: 'unread' } : page)),
      })
    },

    discard: () => {
      cancelRequests()
      keptPlan = undefined
      set({ ...CLOSED })
      if (saveTimer) clearTimeout(saveTimer)
      void window.api.notes.clearSession()
      const dictation = useDictationStore.getState()
      if (dictation.notes) dictation.close({ discard: true })
    },

    finished: () => get().discard(),

    backToPages: () => {
      keepNotesPlan(undefined)
      set({ open: true, waiting: false })
    },

    restore: async () => {
      const session = await window.api.notes.getSession().catch(() => null)
      if (!isSession(session) || (session.pages.length === 0 && !session.plan)) return
      keptPlan = session.plan
      set({
        ...CLOSED,
        title: session.title,
        date: session.date,
        dateSet: true,
        // A page that was being read when the app closed is read again.
        pages: session.pages.map((page) => (page.status === 'reading' ? { ...page, status: 'unread' } : page)),
        waiting: true,
      })
    },

    openWaiting: () => {
      const plan = keptPlan
      set({ waiting: false })
      if (plan) {
        useDictationStore.getState().openNotesPlan({ plan: plan.plan, reference: plan.reference, list: plan.list, mode: plan.mode })
        return
      }
      set({ open: true })
    },
  }

  function handOff(plan: NotesPlan, batches: number, partial: Partial): void {
    const state = get()
    const list = deps?.list() ?? null
    const mode = {
      title: state.title,
      date: state.date || today(),
      batches,
      pages: partial.batches.flat(),
      contextJson: partial.contextJson,
      me: partial.me,
    }
    set({ open: false })
    useDictationStore.getState().openNotesPlan({ plan, reference: partial.reference, list, mode })
  }
})

/** Notes are offered while smart dictation can run (4.9). */
export function canMakeTasksFromNotes(ready: { dictation: boolean }): boolean {
  return ready.dictation
}
