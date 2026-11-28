import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { FolderPlus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/shared/Button'
import { Switch } from '@/components/shared/Switch'
import { cn } from '@/lib/cn'
import { pathOf, type AiWorkspace } from '@/lib/ai/workspace'
import { useDictationStore, type DraftCard } from '@/stores/dictation-store'
import { planGroups, planProjectPath, type CheckedProject } from '../../../shared/ai/brain-dump'
import { AI_LIMITS } from '../../../shared/ai/contract'
import { t } from '../../../shared/i18n'

// The brain dump's parts of the smart dictation sheet (docs/ai-assistant-v1.md section 4.8): the
// switch with the note that says what it does, the dump to talk and type into, the plan grouped by
// project with its new projects, and the field that waits for Update. DictationHost draws them.

const MAX_CHARS = AI_LIMITS.transcript_max_chars

/** The Brain dump switch, offered while nothing has been sent, with the note under it. */
export function BrainDumpSwitch() {
  const { t } = useTranslation()
  const on = useDictationStore((s) => s.brainDump)
  const noteId = useId()
  return (
    <div className="rounded-control border border-[var(--border-color)] px-3 py-2" data-brain-dump-switch="">
      <div className="flex items-center justify-between gap-3">
        <span className="text-task-title font-medium text-[var(--text-primary)]" aria-hidden="true">{t('ai.brainDump.title')}</span>
        <Switch
          aria-label={t('ai.brainDump.title')}
          aria-describedby={noteId}
          checked={on}
          onCheckedChange={(next) => useDictationStore.getState().setBrainDump(next)}
        />
      </div>
      <p id={noteId} className="mt-2 text-caption text-[var(--text-secondary)]">{on ? t('ai.brainDump.noteOn') : t('ai.brainDump.noteOff')}</p>
    </div>
  )
}

/** Said when the dump or the Update field reached its limit and the microphone turned off. */
function FullNote({ show }: { show: boolean }) {
  const { t } = useTranslation()
  if (!show) return null
  return (
    <p role="status" className="text-caption text-[var(--text-secondary)]">
      {t('ai.brainDump.full', { max: MAX_CHARS.toLocaleString('en-US') })}
    </p>
  )
}

/** The dump: each turn of the microphone is added at the end; it can be typed into and corrected. */
export function DumpEditor() {
  const { t } = useTranslation()
  const dump = useDictationStore((s) => s.dump)
  const full = useDictationStore((s) => s.dumpFull) || dump.length >= MAX_CHARS
  const ref = useRef<HTMLTextAreaElement>(null)
  const previous = useRef(dump)

  // Ready to type into, at the end of what is there.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  // Words added at the end (a turn of the microphone) stay in view.
  useEffect(() => {
    const el = ref.current
    if (el && dump.length > previous.current.length && dump.startsWith(previous.current.trimEnd())) el.scrollTop = el.scrollHeight
    previous.current = dump
  }, [dump])

  return (
    <div className="space-y-1">
      <textarea
        ref={ref}
        aria-label={t('ai.brainDump.dumpLabel')}
        value={dump}
        maxLength={MAX_CHARS}
        rows={8}
        placeholder={t('ai.brainDump.dumpPlaceholder')}
        onChange={(e) => useDictationStore.getState().setDump(e.target.value)}
        className="w-full resize-y rounded-control border border-[var(--border-color)] bg-transparent px-3 py-2 text-task-title text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
      />
      <FullNote show={full} />
    </div>
  )
}

/** What was said or typed after the plan, waiting until Update sends it as an edit (4.8.4). */
export function UpdateField({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const more = useDictationStore((s) => s.more)
  const requesting = useDictationStore((s) => s.edit.phase === 'requesting')
  const full = useDictationStore((s) => s.dumpFull) || more.length >= MAX_CHARS
  const id = useId()
  const send = () => void useDictationStore.getState().update()
  return (
    <div className="space-y-1 rounded-control border border-[var(--border-color)] px-3 py-2" data-update-field="">
      <label htmlFor={id} className="text-caption font-medium text-[var(--text-secondary)]">
        {t('ai.brainDump.updateLabel')}
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id={id}
          value={more}
          maxLength={MAX_CHARS}
          rows={2}
          disabled={disabled}
          placeholder={t('ai.brainDump.updatePlaceholder')}
          onChange={(e) => useDictationStore.getState().setMore(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
          className="min-w-0 flex-1 resize-y rounded-control border border-[var(--border-color)] bg-transparent px-2 py-1 text-meta text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
        />
        <Button variant="secondary" disabled={disabled || requesting || more.trim() === ''} onClick={send}>{t('ai.brainDump.update')}</Button>
      </div>
      <FullNote show={full} />
    </div>
  )
}

/** Where a new project goes: "in Home", "in Garden" (a new one), or the top level. */
function whereText(project: CheckedProject, projects: readonly CheckedProject[], ws: AiWorkspace): string {
  if (project.parent_id !== null) return t('ai.brainDump.inProject', { project: pathOf(ws, project.parent_id) || t('ai.brainDump.inAProject') })
  if (project.parent_ref !== null) return t('ai.brainDump.inProject', { project: planProjectPath(project.parent_ref, projects, (id) => pathOf(ws, id)) })
  return t('ai.brainDump.topLevel')
}

function NewProjectHeader({ project, projects, ws, disabled, changed }: {
  project: CheckedProject
  projects: readonly CheckedProject[]
  ws: AiWorkspace
  disabled: boolean
  changed: boolean
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(project.title)
  useEffect(() => setTitle(project.title), [project.title])
  const commit = () => {
    const next = title.replace(/[\r\n]+/g, ' ').trim()
    if (next && next !== project.title) useDictationStore.getState().renameProject(project.ref, next)
    else setTitle(project.title)
  }
  return (
    <div className={cn('flex items-center gap-2 rounded-control', changed && 'ring-2 ring-accent-blue/40')} data-new-project={project.ref}>
      <FolderPlus className="h-4 w-4 shrink-0 text-accent-blue" aria-hidden="true" />
      <input
        aria-label={t('ai.brainDump.newProjectName')}
        value={title}
        disabled={disabled}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        className="min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-1 text-group text-[var(--text-primary)] hover:border-[var(--border-color)]"
      />
      <span className="shrink-0 rounded-chip bg-accent-blue/12 px-2 py-0.5 text-chip text-accent-blue">{t('ai.brainDump.newBadge')}</span>
      <span className="min-w-0 truncate text-caption text-[var(--text-secondary)]">{whereText(project, projects, ws)}</span>
      <button
        type="button"
        aria-label={t('ai.brainDump.removeProjectLabel', { title: project.title })}
        title={t('ai.brainDump.removeProjectTitle')}
        disabled={disabled}
        onClick={() => useDictationStore.getState().removeProject(project.ref)}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-danger"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

/**
 * The plan (4.8.5): the tasks under the project they go in, the projects in the order of their
 * first task, then the new projects without tasks. An existing project is named by its path; a new
 * one can be renamed or removed.
 */
export function PlanView({ ws, disabled, renderCard }: { ws: AiWorkspace; disabled: boolean; renderCard: (card: DraftCard) => ReactNode }) {
  const { t } = useTranslation()
  const projects = useDictationStore((s) => s.projects)
  const cards = useDictationStore((s) => s.cards)
  const changed = useDictationStore((s) => s.changedProjects)
  const notes = useDictationStore((s) => s.projectNotes)
  const groups = useMemo(() => planGroups(projects, cards.map((card) => card.draft)), [projects, cards])
  const cardOf = useMemo(() => new Map(cards.map((card) => [card.draft.ref, card])), [cards])
  return (
    <div className="space-y-4" data-plan="">
      {groups.map((group) => {
        const name = group.project.kind === 'new' ? group.project.project.title : pathOf(ws, group.project.id) || t('ai.brainDump.inbox')
        return (
          <section key={group.key} aria-label={name} className="space-y-2">
            {group.project.kind === 'new' ? (
              <NewProjectHeader
                project={group.project.project}
                projects={projects}
                ws={ws}
                disabled={disabled}
                changed={changed.includes(group.project.project.ref)}
              />
            ) : (
              <h3 className="px-1 text-group text-[var(--text-primary)]">{name}</h3>
            )}
            {group.drafts.length > 0 ? (
              <ul className="space-y-2" aria-label={t('ai.brainDump.tasksIn', { name })}>
                {group.drafts.map((draft) => {
                  const card = cardOf.get(draft.ref)
                  return card ? <li key={draft.ref}>{renderCard(card)}</li> : null
                })}
              </ul>
            ) : (
              <p className="px-1 text-caption text-[var(--text-secondary)]">{t('ai.brainDump.noTasks')}</p>
            )}
          </section>
        )
      })}
      {notes.length > 0 && (
        <ul className="space-y-1 px-1 text-caption text-danger" aria-label={t('ai.brainDump.leftOut')}>
          {notes.map((note, i) => <li key={i}>{note}</li>)}
        </ul>
      )}
    </div>
  )
}
