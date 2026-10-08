import { useRef, useState } from 'react'
import { CalendarClock, CheckCircle2, FolderInput, Tag, Trash2, X } from 'lucide-react'
import { useSelectionStore } from '@/stores/selection-store'
import { useSelectedTasks } from '@/hooks/use-selected-tasks'
import { useTaskActions } from '@/hooks/use-task-actions'
import { NULL_DATE } from '@/lib/constants'
import { cn } from '@/lib/cn'
import { nextRowAfterRemoval, visibleRowIds } from '@/lib/row-focus'
import { WhenPopover } from './WhenPopover'
import { ProjectPickerPopover } from './ProjectPickerPopover'
import { LabelPickerPopover } from './LabelPickerPopover'

type Picker = 'date' | 'project' | 'label' | null

const BUTTON =
  'inline-flex min-h-7 items-center gap-1.5 rounded-control px-2.5 text-meta text-text transition-colors duration-fade-fast hover:bg-bg-hover disabled:opacity-40'

/**
 * The bar under the list while two or more tasks are selected: how many, and the five things you
 * do to a group. Every action works on the cached tasks through the same hooks as the context
 * menu, so offline queueing and undo behave the same. Escape clears the selection (TaskList).
 */
export function SelectionBar() {
  const selectedTaskIds = useSelectionStore((s) => s.selectedTaskIds)
  const clearSelection = useSelectionStore((s) => s.clearSelection)
  const tasks = useSelectedTasks(selectedTaskIds)
  const actions = useTaskActions(tasks)
  const [picker, setPicker] = useState<Picker>(null)
  const dateRef = useRef<HTMLButtonElement>(null)
  const projectRef = useRef<HTMLButtonElement>(null)
  const labelRef = useRef<HTMLButtonElement>(null)

  const setFocusedTask = useSelectionStore((s) => s.setFocusedTask)

  const count = selectedTaskIds.size
  if (count < 2) return null

  // The bar and its Delete button vanish with the selection, which would leave focus on the page
  // body. Work out where focus goes before the rows go, and put it there once the delete went through
  // (a cancelled confirmation leaves the selection, and focus stays on the button).
  const deleteSelected = async () => {
    const removed = new Set(selectedTaskIds)
    const next = nextRowAfterRemoval(visibleRowIds(), removed)
    const listEl = document.querySelector('[data-task-id]')?.closest<HTMLElement>('[role="list"]') ?? null
    await actions.deleteAll()
    if (useSelectionStore.getState().selectedTaskIds.size >= 2) return
    if (next !== null) {
      setFocusedTask(next)
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-task-id="${next}"]`)?.focus({ preventScroll: true })
      })
    } else if (listEl) {
      listEl.setAttribute('tabindex', '-1')
      listEl.focus({ preventScroll: true })
    }
  }

  const toggle = (next: Exclude<Picker, null>) => setPicker((p) => (p === next ? null : next))
  const allSameProject = tasks.length > 0 && tasks.every((t) => t.project_id === tasks[0].project_id)
  const anyNotDone = tasks.some((t) => !t.done)

  return (
    <div className="vicu-bar-rise shrink-0 border-t border-[var(--border-color)] bg-bg-card px-4 py-2">
      <div role="toolbar" aria-label="Selected tasks" className="mx-auto flex max-w-reading flex-wrap items-center gap-1">
        <span role="status" className="mr-2 text-meta font-medium text-text">
          {count} selected
        </span>

        <button ref={dateRef} type="button" className={cn(BUTTON, picker === 'date' && 'bg-bg-selected')} aria-haspopup="dialog" aria-expanded={picker === 'date'} onClick={() => toggle('date')}>
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          Schedule
        </button>
        {picker === 'date' && (
          <WhenPopover anchorRef={dateRef} currentDate={NULL_DATE} allowClear onDateChange={actions.setDueDateIso} onClose={() => setPicker(null)} />
        )}

        <button type="button" className={BUTTON} disabled={!anyNotDone} onClick={() => void actions.completeAll()}>
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Complete
        </button>

        <button ref={projectRef} type="button" className={cn(BUTTON, picker === 'project' && 'bg-bg-selected')} aria-haspopup="listbox" aria-expanded={picker === 'project'} onClick={() => toggle('project')}>
          <FolderInput className="h-3.5 w-3.5" aria-hidden="true" />
          Move
        </button>
        {picker === 'project' && (
          <ProjectPickerPopover
            anchorRef={projectRef}
            currentProjectId={allSameProject ? tasks[0].project_id : undefined}
            onSelect={(projectId) => {
              actions.moveToProject(projectId)
              void actions.recordLastProject(projectId)
            }}
            onClose={() => setPicker(null)}
          />
        )}

        <button ref={labelRef} type="button" className={cn(BUTTON, picker === 'label' && 'bg-bg-selected')} aria-haspopup="dialog" aria-expanded={picker === 'label'} onClick={() => toggle('label')}>
          <Tag className="h-3.5 w-3.5" aria-hidden="true" />
          Tag
        </button>
        {picker === 'label' && (
          <LabelPickerPopover anchorRef={labelRef} tasks={tasks} onApplied={(label) => void actions.recordLastLabel(label)} onClose={() => setPicker(null)} />
        )}

        <button type="button" className={cn(BUTTON, 'text-danger hover:bg-danger/10')} onClick={() => void deleteSelected()}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Delete
        </button>

        <button type="button" className={cn(BUTTON, 'ml-auto w-7 justify-center px-0 text-text-secondary')} aria-label="Clear selection" title="Clear selection (Esc)" onClick={clearSelection}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
