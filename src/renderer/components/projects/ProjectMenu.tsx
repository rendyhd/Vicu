import { useMemo, useRef, useState, type RefObject } from 'react'
import {
  Archive,
  Check,
  CheckCircle2,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Inbox,
  Pencil,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Timer,
  Trash2,
  EyeOff,
  Eye,
} from 'lucide-react'
import { Menu, MenuItem, MenuSeparator } from '@/components/overlay/Menu'
import { Popover, type PopoverCloseReason } from '@/components/overlay/Popover'
import { useAppConfig } from '@/hooks/use-app-config'
import { useProjects } from '@/hooks/use-projects'
import { useSharedProjectActions } from '@/hooks/use-project-actions'
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed'
import { normalizeHex } from '@/lib/constants'
import { childrenOf, descendantIds, effectiveParent, placeAt, TOP_LEVEL } from '@/lib/project-moves'
import { parseReviewFooter } from '@/lib/review-metadata'
import { projectActions, type ProjectSurface } from '@/stores/project-actions-store'
import type { Project } from '@/lib/vikunja-types'
import { parentOptions } from './ProjectDialog'

interface ParentPickerProps {
  anchorRef: RefObject<HTMLElement | null>
  project: Project
  projects: readonly Project[]
  inboxId: number
  onSelect: (parentId: number) => void
  onClose: (reason?: PopoverCloseReason) => void
}

/** "Move to…": the top level and every project the project can go under, as a tree. */
function ParentPicker({ anchorRef, project, projects, inboxId, onSelect, onClose }: ParentPickerProps) {
  const current = effectiveParent(project, projects)
  const options = useMemo(() => {
    const exclude = descendantIds(project.id, projects).add(project.id)
    if (inboxId) exclude.add(inboxId)
    return parentOptions(projects, exclude)
  }, [project.id, projects, inboxId])

  const choose = (parentId: number) => {
    if (parentId !== current) onSelect(parentId)
    onClose()
  }

  const option = (key: string, label: string, parentId: number, depth: number, color?: string) => (
    <button
      key={key}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={parentId === current}
      onClick={() => choose(parentId)}
      className="flex w-full items-center gap-2 py-1.5 pr-3 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]"
      style={{ paddingLeft: `${depth * 12 + 12}px` }}
    >
      <FolderOpen aria-hidden="true" className="h-3 w-3 shrink-0" style={{ color: color || 'var(--text-secondary)' }} strokeWidth={1.8} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {parentId === current && <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" />}
    </button>
  )

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} placement="right-start" role="listbox" label="Move to" className="w-60 py-1">
      <div className="max-h-72 overflow-y-auto">
        {option('top', 'Top level', TOP_LEVEL, 0)}
        {options.map(({ project: item, depth }) =>
          option(String(item.id), item.title, item.id, depth + 1, normalizeHex(item.hex_color)),
        )}
      </div>
    </Popover>
  )
}

export interface ProjectMenuProps {
  project: Project
  /** Where the menu was opened: Rename and Add subproject work in place in the sidebar. */
  surface: ProjectSurface
  /** The button that opened it, or the point of a right-click. */
  anchorRef?: RefObject<HTMLElement | null>
  anchorPoint?: { x: number; y: number }
  /** Where focus goes when a dialog the menu opened closes (the row or button it came from). */
  opener?: HTMLElement | null
  onClose: () => void
}

type Sub = 'move' | 'review' | null

/**
 * The one project menu, used by the sidebar (the … button and right-click), the project page
 * header and the Settings project list. An archived project offers Restore and Delete only.
 */
export function ProjectMenu({ project, surface, anchorRef, anchorPoint, opener = null, onClose }: ProjectMenuProps) {
  const moveRef = useRef<HTMLButtonElement>(null)
  const reviewRef = useRef<HTMLButtonElement>(null)
  const [sub, setSub] = useState<Sub>(null)
  const { data } = useProjects()
  const { data: config } = useAppConfig()
  const { setCollapsed } = useSidebarCollapsed()
  const actions = useSharedProjectActions()

  const projects = data?.flat ?? []
  const inboxId = config?.inbox_project_id ?? 0
  const isInbox = project.id === inboxId
  const reviewEnabled = config?.review?.enabled ?? true
  const excludeInbox = config?.review?.exclude_inbox ?? true
  const reviewState = parseReviewFooter(project.description).state
  const showReview = reviewEnabled && !(isInbox && excludeInbox)
  const label = `${project.title} actions`

  // A picker or submenu closes the menu too once something was chosen; Escape or a press
  // elsewhere closes only that layer.
  const closeSub = (reason?: PopoverCloseReason) => {
    setSub(null)
    if (reason !== 'dismiss') onClose()
  }

  if (project.is_archived) {
    return (
      <Menu anchorRef={anchorRef} anchorPoint={anchorPoint} label={label} onClose={onClose}>
        <MenuItem icon={<RotateCcw />} onSelect={() => actions.restore(project)}>
          Restore
        </MenuItem>
        <MenuItem icon={<Trash2 />} danger onSelect={() => void actions.remove(project, opener)}>
          Delete
        </MenuItem>
      </Menu>
    )
  }

  return (
    <Menu anchorRef={anchorRef} anchorPoint={anchorPoint} label={label} onClose={onClose}>
      {surface !== 'page' && (
        <MenuItem icon={<Pencil />} shortcut="F2" onSelect={() => projectActions.startRename(project.id, surface)}>
          Rename
        </MenuItem>
      )}
      <MenuItem icon={<SlidersHorizontal />} onSelect={() => projectActions.openDialog({ kind: 'edit', project }, opener)}>
        Edit…
      </MenuItem>
      <MenuItem
        icon={<FolderPlus />}
        onSelect={() => {
          if (surface === 'sidebar') {
            setCollapsed(project.id, false)
            projectActions.startCreate(project.id)
          } else {
            projectActions.openDialog({ kind: 'create', parentId: project.id }, opener)
          }
        }}
      >
        Add subproject
      </MenuItem>
      {!isInbox && (
        <MenuItem
          ref={moveRef}
          icon={<FolderInput />}
          popup="listbox"
          expanded={sub === 'move'}
          onSelect={() => setSub((s) => (s === 'move' ? null : 'move'))}
        >
          Move to…
        </MenuItem>
      )}
      {sub === 'move' && (
        <ParentPicker
          anchorRef={moveRef}
          project={project}
          projects={projects}
          inboxId={inboxId}
          onSelect={(parentId) => {
            const siblings = childrenOf(projects, parentId).filter((p) => p.id !== project.id)
            const placement = placeAt(projects, project.id, parentId, siblings.length)
            if (placement) actions.move(project, placement)
          }}
          onClose={closeSub}
        />
      )}

      {(!isInbox || showReview) && <MenuSeparator />}
      {!isInbox && (
        <MenuItem icon={<Inbox />} onSelect={() => void actions.setInbox(project)}>
          Set as Inbox
        </MenuItem>
      )}
      {showReview && (
        <MenuItem
          ref={reviewRef}
          icon={<RefreshCw />}
          popup="menu"
          expanded={sub === 'review'}
          onSelect={() => setSub((s) => (s === 'review' ? null : 'review'))}
        >
          Review
        </MenuItem>
      )}
      {sub === 'review' && (
        <Menu anchorRef={reviewRef} placement="right-start" label="Review" onClose={closeSub}>
          {reviewState === 'excluded' ? (
            <MenuItem icon={<Eye />} onSelect={() => actions.setExcludedFromReview(project, false)}>
              Include in review
            </MenuItem>
          ) : (
            <>
              <MenuItem icon={<CheckCircle2 />} onSelect={() => actions.markReviewed(project)}>
                Mark reviewed
              </MenuItem>
              <MenuItem icon={<Timer />} onSelect={() => projectActions.openDialog({ kind: 'cadence', project }, opener)}>
                Review cadence…
              </MenuItem>
              <MenuItem icon={<EyeOff />} onSelect={() => actions.setExcludedFromReview(project, true)}>
                Exclude from review
              </MenuItem>
            </>
          )}
        </Menu>
      )}

      {!isInbox && (
        <>
          <MenuSeparator />
          <MenuItem icon={<Archive />} onSelect={() => void actions.archive(project, opener)}>
            Archive
          </MenuItem>
          <MenuItem icon={<Trash2 />} danger onSelect={() => void actions.remove(project, opener)}>
            Delete
          </MenuItem>
        </>
      )}
    </Menu>
  )
}
