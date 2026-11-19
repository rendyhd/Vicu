import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, FileText, Image as ImageIcon, Loader2, Trash2, X } from 'lucide-react'
import { Dialog } from '@/components/overlay/Dialog'
import { Button } from '@/components/shared/Button'
import { cn } from '@/lib/cn'
import { useAiReady, useAiSettings, useAiWorkspace, useSaveAiSettings } from '@/hooks/use-ai'
import { useCollabMe, useProjectAccessMap } from '@/hooks/use-project-access'
import { usePersonLabels } from '@/hooks/use-people'
import { useProAssistantOn } from '@/hooks/use-pro-assistant'
import { listInfoOf } from '@/lib/ai/workspace'
import { toLocalDate } from '@/lib/due-dates'
import { imageUrl } from '@/lib/notes/images'
import { notesFileOfBlob, transcriptPages, unreadPages, type NotesFileIssue, type NotesSourcePage } from '@/lib/notes/pages'
import { keepNotesPlan, setNotesDeps, useNotesStore } from '@/stores/notes-store'
import { useDictationStore } from '@/stores/dictation-store'
import { useVoiceListStore } from '@/stores/voice-list-store'
import { useToastStore } from '@/stores/toast-store'
import { AI_LIMITS, providerPreset } from '../../../shared/ai/contract'
import type { NotesDraft } from '../../../shared/ai/notes'
import type { NotesFile } from '../../../shared/notes-import-types'

/**
 * Notes to tasks (docs/ai-assistant-v1.md section 4.9): the notes screen, where sources become
 * pages, pictures are read, and the transcript can be corrected before Organize hands the plan to
 * the dictation sheet. Also wires what the store needs from the window, brings back notes kept from
 * an earlier run, and takes files dropped on the window. Mounted once, in AppShell.
 */
export function NotesHost() {
  const { t } = useTranslation()
  const ws = useAiWorkspace()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const me = useCollabMe()
  const access = useProjectAccessMap()
  const personLabels = usePersonLabels()
  const proAssistant = useProAssistantOn()
  const saveAi = useSaveAiSettings()
  const { data: settings } = useAiSettings()
  const ready = useAiReady()
  const open = useNotesStore((s) => s.open)
  const waiting = useNotesStore((s) => s.waiting)
  const live = useRef({ ws, pathname, me, access, personLabels, proAssistant, settings, saveAi, ready })
  live.current = { ws, pathname, me, access, personLabels, proAssistant, settings, saveAi, ready }

  useEffect(() => {
    setNotesDeps({
      workspace: () => live.current.ws,
      list: () => listInfoOf(live.current.pathname, live.current.ws, useVoiceListStore.getState().defaults, toLocalDate),
      locale: () => navigator.language,
      me: () => live.current.me?.name?.trim() || live.current.me?.username || null,
      people: () => {
        const names: string[] = []
        for (const entry of live.current.access.values()) {
          if (!entry.shared) continue
          for (const member of entry.members) {
            if (member.id === live.current.me?.id) continue
            names.push(member.name?.trim() || member.username)
          }
        }
        if (live.current.proAssistant) for (const label of live.current.personLabels.values()) names.push(label.title)
        return names
      },
      settings: () => window.api.ai.getSettings(),
      saveConsent: async (keys) => {
        const current = await window.api.ai.getSettings()
        await live.current.saveAi({ consented: [...new Set([...current.consented, ...keys])] })
      },
    })
    void useNotesStore.getState().restore()
    return () => setNotesDeps(null)
  }, [])

  // Notes kept from an earlier run: offered once, with Open.
  useEffect(() => {
    if (!waiting) return
    const title = useNotesStore.getState().title.trim()
    useToastStore.getState().push('info', title ? t('notes.stillOpen', { title }) : t('notes.stillOpenUntitled'), {
      key: 'notes-waiting',
      durationMs: 15_000,
      action: { label: t('notes.open'), onAction: () => useNotesStore.getState().openWaiting() },
    })
  }, [waiting, t])

  // The plan under review is kept with the notes until it is added or discarded (4.9.11).
  useEffect(() => useDictationStore.subscribe((state) => {
    if (state.source !== 'notes' || !state.notes || (state.phase !== 'cards' && state.phase !== 'adding')) return
    keepNotesPlan({
      plan: {
        projects: state.projects,
        drafts: state.cards.map((card) => ({ ...card.draft, owner: card.draft.owner ?? null, page: card.draft.page ?? null, from: card.draft.from ?? null }) as NotesDraft),
        decisions: state.notes.decisions,
        questions: state.notes.questions,
        dropped: state.cards.flatMap((card) => card.dropped),
        unclear: state.unclear,
      },
      mode: state.notes,
      reference: state.reference,
      list: state.list,
    })
  }), [])

  // Files dropped on the window (not on a task, which keeps its attachment drop) become notes.
  useEffect(() => {
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true
    const over = (event: DragEvent) => {
      if (!hasFiles(event) || event.defaultPrevented || !live.current.ready.dictation) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const drop = (event: DragEvent) => {
      if (!hasFiles(event) || event.defaultPrevented || !live.current.ready.dictation) return
      event.preventDefault()
      const dropped = Array.from(event.dataTransfer?.files ?? [])
      if (dropped.length === 0) return
      void (async () => {
        const files: NotesFile[] = []
        for (const file of dropped.slice(0, AI_LIMITS.notes_pages_max)) {
          files.push(file.size > AI_LIMITS.notes_file_max_mb * 1024 * 1024
            ? { name: file.name, type: file.type, problem: 'size' }
            : await notesFileOfBlob(file, file.name))
        }
        useNotesStore.getState().openNotes({ files })
      })()
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  return open ? <NotesDialog /> : null
}

function NotesDialog() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const titleId = useId()
  const textId = useId()
  const state = useNotesStore()
  const { data: settings } = useAiSettings()
  const { title, date, pages, issues, busy, problem, reader, overLimit, partial } = state
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState('')
  const store = useNotesStore.getState
  const issueText = (issue: NotesFileIssue): string => {
    switch (issue.problem) {
      case 'type': return t('notes.fileProblem.type', { name: issue.name })
      case 'size': return t('notes.fileProblem.size', { name: issue.name, mb: AI_LIMITS.notes_file_max_mb })
      case 'heic': return t('notes.fileProblem.heic', { name: issue.name })
      case 'password': return t('notes.fileProblem.password', { name: issue.name })
      case 'image': return t('notes.fileProblem.image', { name: issue.name })
      case 'more': return t('notes.morePdfPages', { name: issue.name })
      default: return t('notes.fileProblem.unreadable', { name: issue.name })
    }
  }

  const unread = unreadPages(pages).filter((page) => page.image).length
  const withText = transcriptPages(pages).length
  const canOrganize = !busy && unread === 0 && withText > 0
  const providerName = (settings?.provider && providerPreset(settings.provider)?.name) || t('settings.assistant.consent.theProvider')

  const addFiles = async () => {
    const picked = await window.api.notes.pickFiles()
    if (picked.files.length > 0) await store().addFiles(picked.files)
  }

  const onPaste = (event: React.ClipboardEvent) => {
    const target = event.target as HTMLElement
    if (target.closest('textarea, input')) return
    const items = Array.from(event.clipboardData.items)
    const picture = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'))
    if (picture) {
      const blob = picture.getAsFile()
      if (blob) {
        event.preventDefault()
        void store().addPicture(blob, t('notes.pastedPicture'))
      }
      return
    }
    const text = event.clipboardData.getData('text/plain')
    if (text.trim()) {
      event.preventDefault()
      store().addText(text, t('notes.typedText'))
    }
  }

  const status = busy?.kind === 'reading'
    ? t('notes.readingProgress', { done: busy.done, total: busy.total })
    : busy?.kind === 'organizing'
      ? t('notes.organizing', { batch: busy.batch, total: busy.total })
      : busy?.kind === 'testing'
        ? t('notes.testingReader', { model: busy.model })
        : null

  return (
    <Dialog open onClose={() => store().close()} labelledBy={titleId} className="flex h-[86vh] w-[880px] max-w-[94vw] flex-col">
      <div className="flex min-h-0 flex-1 flex-col" onPaste={onPaste} data-notes-dialog="">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <h2 id={titleId} className="flex-1 text-card-title text-text">{t('notes.title')}</h2>
          <button
            type="button"
            aria-label={t('notes.close')}
            onClick={() => store().close()}
            className="inline-flex h-7 w-7 items-center justify-center rounded-control text-text-secondary hover:bg-bg-hover hover:text-text"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-meta text-text-secondary">{t('notes.intro')}</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="mb-1 block text-caption text-text-secondary">{t('notes.notesTitle')}</span>
              <input
                value={title}
                placeholder={t('notes.notesTitlePlaceholder')}
                onChange={(e) => store().setTitle(e.target.value)}
                className="w-full rounded-control border border-border bg-bg-page px-3 py-1.5 text-task-title text-text"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-caption text-text-secondary">{t('notes.date')}</span>
              <input
                type="date"
                value={date}
                onChange={(e) => e.target.value && store().setDate(e.target.value)}
                className="rounded-control border border-border bg-bg-page px-3 py-1.5 text-task-title text-text"
              />
            </label>
          </div>
          <p className="-mt-2 text-caption text-text-secondary">{t('notes.dateHelp')}</p>

          <div className="space-y-2 rounded-control border border-dashed border-border px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={busy !== null} onClick={() => void addFiles()}>{t('notes.addFiles')}</Button>
              <Button variant="quiet" aria-expanded={typing} disabled={busy !== null} onClick={() => setTyping(!typing)}>{t('notes.addText')}</Button>
              <span className="text-caption text-text-secondary">{t('notes.dropHere')}</span>
              {busy?.kind === 'adding' && <Loader2 className="h-4 w-4 animate-spin text-text-secondary" aria-hidden="true" />}
            </div>
            {typing && (
              <div className="space-y-2">
                <label htmlFor={textId} className="sr-only">{t('notes.textLabel')}</label>
                <textarea
                  id={textId}
                  value={typed}
                  rows={6}
                  autoFocus
                  placeholder={t('notes.textPlaceholder')}
                  onChange={(e) => setTyped(e.target.value)}
                  className="w-full resize-y rounded-control border border-border bg-bg-page px-3 py-2 text-meta text-text placeholder:text-text-secondary"
                />
                <Button
                  variant="secondary"
                  disabled={!typed.trim()}
                  onClick={() => {
                    store().addText(typed, t('notes.typedText'))
                    setTyped('')
                    setTyping(false)
                  }}
                >
                  {t('notes.addThisText')}
                </Button>
              </div>
            )}
          </div>

          {(issues.length > 0 || overLimit) && (
            <ul className="space-y-0.5 text-meta text-danger" role="alert">
              {issues.map((issue, i) => <li key={i}>{issueText(issue)}</li>)}
              {overLimit && <li>{t('notes.tooManyPages', { count: AI_LIMITS.notes_pages_max })}</li>}
            </ul>
          )}

          {problem?.kind === 'consent' && (
            <div className="space-y-2 rounded-control border border-border px-3 py-3" role="alertdialog" aria-labelledby={`${titleId}-consent`}>
              <p id={`${titleId}-consent`} className="text-task-title font-medium text-text">{t('notes.consent.title', { provider: providerName })}</p>
              <p className="text-meta text-text-secondary">{t('notes.consent.text', { provider: providerName })}</p>
              <div className="flex justify-end gap-2">
                <Button variant="quiet" onClick={() => store().dismissProblem()}>{t('notes.consent.cancel')}</Button>
                <Button variant="primary" data-autofocus="" onClick={() => void store().agreeToImages()}>{t('notes.consent.agree')}</Button>
              </div>
            </div>
          )}
          {problem?.kind === 'no-reader' && (
            <div className="flex flex-wrap items-center gap-2 rounded-control border border-border px-3 py-2" role="alert">
              <p className="min-w-0 flex-1 text-meta text-text">{t('notes.noReader')}</p>
              <Button variant="secondary" onClick={() => {
                store().close()
                void navigate({ to: '/settings', search: { section: 'assistant' } })
              }}>{t('notes.openSettings')}</Button>
            </div>
          )}
          {problem?.kind === 'nothing' && <p className="text-meta text-text" role="status">{t('notes.nothing')}</p>}
          {problem?.kind === 'organize' && (
            <div className="flex flex-wrap items-center gap-2 rounded-control border border-border px-3 py-2" role="alert">
              <p className="min-w-0 flex-1 text-meta text-danger">{t('notes.organizeFailed', { batch: problem.batch, total: problem.total, error: problem.message })}</p>
              {partial && partial.plan.drafts.length > 0 && (
                <Button variant="quiet" onClick={() => store().reviewSoFar()}>{t('notes.reviewSoFar', { count: partial.plan.drafts.length })}</Button>
              )}
              <Button variant="secondary" onClick={() => void store().organize()}>{t('notes.retry')}</Button>
            </div>
          )}

          {pages.length === 0 ? (
            <p className="text-meta text-text-secondary">{t('notes.empty')}</p>
          ) : (
            <ol className="space-y-3" aria-label={t('notes.pages', { count: pages.length })}>
              {pages.map((page, index) => (
                <PageRow key={page.id} page={page} n={index + 1} last={index === pages.length - 1} busy={busy !== null} />
              ))}
            </ol>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <p className="mr-auto flex min-w-0 items-center gap-2 text-meta text-text-secondary" role="status">
            {status && <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
            <span className="truncate">{status ?? (reader && unread === 0 && pages.some((p) => p.image) ? t('notes.readBy', { model: reader }) : unread > 0 && withText > 0 ? t('notes.readFirst') : '')}</span>
          </p>
          <Button variant="quiet" danger onClick={() => store().discard()}>{t('notes.discard')}</Button>
          {busy && busy.kind !== 'adding' ? (
            <Button variant="secondary" onClick={() => store().cancel()}>{t('settings.assistant.cancel')}</Button>
          ) : (
            <>
              {unread > 0 && <Button variant={canOrganize ? 'secondary' : 'primary'} onClick={() => void store().readPages()}>{t('notes.read', { count: unread })}</Button>}
              <Button variant="primary" disabled={!canOrganize} onClick={() => void store().organize()}>{t('notes.organize')}</Button>
            </>
          )}
        </footer>
      </div>
    </Dialog>
  )
}

function PageRow({ page, n, last, busy }: { page: NotesSourcePage; n: number; last: boolean; busy: boolean }) {
  const { t } = useTranslation()
  const store = useNotesStore.getState
  const kind = page.kind === 'text' ? t('notes.kind.text') : page.kind === 'image' ? t('notes.kind.image') : page.asImage ? t('notes.kind.pdfImage') : t('notes.kind.pdf')
  const iconButton = 'inline-flex h-7 w-7 items-center justify-center rounded-control text-text-secondary hover:bg-bg-hover hover:text-text disabled:opacity-40'
  return (
    <li className="flex gap-3 rounded-card border border-border p-3" data-notes-page={n} data-status={page.status}>
      <div className="w-28 shrink-0">
        {page.image ? (
          <img src={imageUrl(page.image)} alt={t('notes.pagePicture', { n })} className="w-full rounded-control border border-border bg-white object-contain" />
        ) : (
          <div className="flex h-20 items-center justify-center rounded-control border border-border text-text-secondary">
            <FileText className="h-6 w-6" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-task-title font-medium text-text">{t('notes.page', { n })}</span>
          <span className="inline-flex items-center gap-1 text-caption text-text-secondary">
            {page.image && page.kind !== 'text' ? <ImageIcon className="h-3 w-3" aria-hidden="true" /> : null}
            {kind}{page.source ? ` · ${page.source}` : ''}
          </span>
          <span className="ml-auto flex items-center gap-1">
            {page.kind === 'pdf' && page.image && (
              <Button variant="quiet" disabled={busy} onClick={() => store().setReadAsImage(page.id, !page.asImage)}>
                {page.asImage ? t('notes.useTextLayer') : t('notes.readAsImage')}
              </Button>
            )}
            <button type="button" className={iconButton} disabled={busy || n === 1} aria-label={t('notes.moveUp', { n })} onClick={() => store().movePage(page.id, -1)}>
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className={iconButton} disabled={busy || last} aria-label={t('notes.moveDown', { n })} onClick={() => store().movePage(page.id, 1)}>
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className={cn(iconButton, 'hover:text-danger')} disabled={busy} aria-label={t('notes.removePage', { n })} onClick={() => store().removePage(page.id)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </span>
        </div>
        {page.status === 'ready' ? (
          <textarea
            aria-label={t('notes.pageText', { n })}
            value={page.text}
            rows={Math.min(12, Math.max(3, page.text.split('\n').length + 1))}
            disabled={busy}
            onChange={(e) => store().setPageText(page.id, e.target.value)}
            className="w-full resize-y rounded-control border border-border bg-bg-page px-2 py-1 font-mono text-meta text-text"
          />
        ) : page.status === 'reading' ? (
          <p className="flex items-center gap-2 text-meta text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('notes.reading')}</p>
        ) : page.status === 'failed' ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-meta text-danger">{t('notes.failed', { error: page.error ?? '' })}</p>
            <Button variant="secondary" disabled={busy} onClick={() => void store().readPages([page.id])}>{t('notes.retry')}</Button>
          </div>
        ) : (
          <p className="text-meta text-text-secondary">{t('notes.unread')}</p>
        )}
      </div>
    </li>
  )
}
