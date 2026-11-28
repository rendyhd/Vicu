import { useMemo, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useTasks } from '@/hooks/use-tasks'
import { OPEN_TASKS_PARAMS } from '@/hooks/use-availability'
import { useProjects } from '@/hooks/use-projects'
import { useProjectAccessMap } from '@/hooks/use-project-access'
import { cachedTasks } from '@/hooks/use-subtask-attach'
import { hasVicuMetadataMarker } from '@/lib/metadata-tasks'
import type { Task } from '@/lib/vikunja-types'
import { Popover, type PopoverCloseReason } from '../overlay/Popover'
import { childCandidates, parentCandidates, subtaskWorldOf } from '../../../shared/subtask-attach'

const LIMIT = 30

type SubtaskPickerProps = {
  anchorRef: RefObject<HTMLElement | null>
  placement?: 'bottom-start' | 'right-start' | 'bottom-end'
  onPick: (task: Task) => void
  onClose: (reason?: PopoverCloseReason) => void
} & (
  /** Choose the parent for these tasks ("Make subtask of..."). */
  | { mode: 'parent'; tasks: Task[] }
  /** Choose a task to put under this parent ("Add existing task"). */
  | { mode: 'child'; parent: Task }
)

/**
 * Finds an existing task by its title (cross-app semantics 24.3): with nothing typed, the tasks of
 * the project the choice starts from; a search looks in every project, that project first.
 */
export function SubtaskPickerPopover(props: SubtaskPickerProps) {
  const { anchorRef, placement = 'right-start', onPick, onClose } = props
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: open = [] } = useTasks(OPEN_TASKS_PARAMS)
  const { data: projectData } = useProjects()
  const access = useProjectAccessMap()
  const [search, setSearch] = useState('')

  const anchorTasks = props.mode === 'parent' ? props.tasks : [props.parent]
  const home = anchorTasks[0]?.project_id
  const anchorKey = anchorTasks.map((task) => task.id).join(',')

  const writable = useMemo(() => {
    const ids = new Set<number>()
    for (const project of projectData?.flat ?? []) {
      if (project.is_archived) continue
      if ((access.get(project.id)?.permission ?? 1) > 0) ids.add(project.id)
    }
    return ids
  }, [projectData, access])

  const projectTitle = (id: number) => projectData?.flat.find((p) => p.id === id)?.title ?? ''

  const offered = useMemo(() => {
    const world = subtaskWorldOf([...open, ...cachedTasks(qc), ...anchorTasks])
    const items = open.map((task) => ({
      id: task.id,
      title: task.title,
      project: task.project_id,
      done: task.done,
      hidden: hasVicuMetadataMarker(task.description),
      task,
    }))
    return props.mode === 'parent'
      ? parentCandidates(world, items, { attaching: anchorTasks.map((task) => task.id), writable, search, limit: LIMIT })
      : childCandidates(world, items, { parent: anchorTasks[0].id, writable, search, limit: LIMIT })
    // The tasks the choice starts from stand in the dependencies as their ids.
  }, [open, qc, writable, search, props.mode, anchorKey])

  const pick = (task: Task) => {
    onPick(task)
    onClose()
  }

  const label = props.mode === 'parent' ? t('task.attach.pickParent') : t('task.attach.pickChild')
  const empty = search.trim() ? t('task.attach.noMatches') : t('task.attach.noTasks')

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} placement={placement} label={label} role="dialog" className="w-80 p-2" initialFocus="input">
      <label className="flex items-center gap-1.5 rounded-control border border-border px-2 py-1">
        <Search className="h-3 w-3 text-text-secondary" aria-hidden="true" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && offered.length > 0) {
              event.preventDefault()
              pick(offered[0].task)
            }
          }}
          placeholder={t('task.attach.search')}
          aria-label={t('task.attach.search')}
          className="min-w-0 flex-1 bg-transparent text-meta text-text outline-none"
        />
      </label>
      {offered.length > 0 ? (
        <ul className="mt-1 max-h-64 overflow-y-auto" role="listbox" aria-label={label}>
          {offered.map(({ task }) => (
            <li key={task.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                tabIndex={-1}
                className="flex w-full items-baseline gap-2 rounded-control px-2 py-1 text-left text-meta text-text hover:bg-bg-hover focus:bg-bg-hover"
                onClick={() => pick(task)}
              >
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
                {task.project_id !== home && (
                  <span className="shrink-0 truncate text-caption text-text-secondary">{t('task.attach.inProject', { project: projectTitle(task.project_id) })}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 px-1 text-caption text-text-secondary">{empty}</p>
      )}
      {!search.trim() && <p className="mt-1 px-1 text-caption text-text-secondary">{t('task.attach.searchHint')}</p>}
    </Popover>
  )
}
