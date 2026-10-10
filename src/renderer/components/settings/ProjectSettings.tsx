import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronRight, Folder, GripVertical, MoreHorizontal, Plus, RefreshCw, RotateCcw } from 'lucide-react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { ReviewSettingsPanel } from '@/components/review/ReviewSettingsPanel'
import { ProjectMenu } from '@/components/projects/ProjectMenu'
import { parentOptions } from '@/components/projects/ProjectDialog'
import {
  DropLine,
  INTO_CLASSES,
  ProjectRenameInput,
  useProjectRowKeys,
} from '@/components/projects/ProjectRowParts'
import { useAppConfig } from '@/hooks/use-app-config'
import { buildProjectTree, useProjects, type ProjectTreeNode } from '@/hooks/use-projects'
import { useSharedProjectActions } from '@/hooks/use-project-actions'
import { cn } from '@/lib/cn'
import { normalizeHex } from '@/lib/constants'
import { projectActions, useProjectActionsStore } from '@/stores/project-actions-store'
import { useRootDropActive, useRowDropZone } from '@/stores/project-drop-store'
import type { AppConfig, Project } from '@/lib/vikunja-types'

const ROOT_ID = 'project-root-settings'

type OpenMenu = (project: Project, at: { point: { x: number; y: number } } | { anchor: HTMLElement }, opener: HTMLElement | null) => void

interface RowProps {
  node: ProjectTreeNode
  depth: number
  inboxId: number
  menuOpenFor: number | null
  renamingId: number | null
  onOpenMenu: OpenMenu
}

/** One active project in the Settings list: click to edit, drag to move, … for everything else. */
function ProjectRow({ node, depth, inboxId, menuOpenFor, renamingId, onOpenMenu }: RowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const isInbox = node.id === inboxId
  const color = normalizeHex(node.hex_color)
  const dndId = `settings-project-${node.id}`
  const menuOpen = menuOpenFor === node.id
  const indent = 12 + depth * 20

  // The Inbox stays where it is; everything else can be dragged. Every row takes drops.
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: dndId,
    disabled: isInbox,
    data: { type: 'project', projectId: node.id, node, surface: 'settings' },
  })
  const { setNodeRef: setDropRef } = useDroppable({
    id: dndId,
    data: { type: 'project', projectId: node.id, node, hasVisibleChildren: node.children.length > 0 },
  })
  const zone = useRowDropZone(dndId)

  const openMenuAtButton = () => {
    if (moreRef.current) onOpenMenu(node, { anchor: moreRef.current }, rowRef.current)
  }
  const handleKeys = useProjectRowKeys(node, 'settings', openMenuAtButton)
  const edit = () => projectActions.openDialog({ kind: 'edit', project: node }, rowRef.current)

  return (
    <>
      <div
        ref={setDropRef}
        className={cn(
          'group relative flex min-h-10 items-center gap-2 border-b border-border/60 pr-2 hover:bg-[var(--bg-hover)]',
          zone === 'into' && INTO_CLASSES,
          menuOpen && 'bg-[var(--bg-hover)]',
        )}
        style={{ paddingLeft: `${indent - 10}px`, opacity: isDragging ? 0.4 : undefined }}
        onContextMenu={(event) => {
          event.preventDefault()
          onOpenMenu(node, { point: { x: event.clientX, y: event.clientY } }, rowRef.current)
        }}
      >
        <DropLine zone={zone} indent={indent} />
        <GripVertical
          aria-hidden="true"
          className={cn('h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)] opacity-0', !isInbox && 'group-hover:opacity-100')}
        />
        {renamingId === node.id ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 py-1.5">
            <Folder aria-hidden="true" className="h-4 w-4 shrink-0" style={{ color: color || 'var(--text-secondary)' }} />
            <ProjectRenameInput project={node} surface="settings" className="text-sm" />
          </div>
        ) : (
          <div
            ref={(element) => {
              setDragRef(element)
              rowRef.current = element
            }}
            // The Inbox cannot be dragged, but it can be edited: it is not announced as disabled.
            {...(isInbox ? {} : attributes)}
            {...listeners}
            role="button"
            tabIndex={0}
            data-project-row={`settings:${node.id}`}
            aria-haspopup="dialog"
            aria-keyshortcuts="F2 Shift+F10 Alt+Shift+ArrowUp Alt+Shift+ArrowDown Alt+Shift+ArrowRight Alt+Shift+ArrowLeft"
            onClick={edit}
            onKeyDown={(event) => {
              if (handleKeys(event)) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                edit()
              }
            }}
            className="flex min-h-10 min-w-0 flex-1 cursor-default items-center gap-2"
          >
            <Folder aria-hidden="true" className="h-4 w-4 shrink-0" style={{ color: color || 'var(--text-secondary)' }} />
            <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">{node.title}</span>
            {isInbox && (
              <span className="vicu-chip rounded-chip bg-[var(--bg-secondary)] px-1.5 py-0.5 text-caption text-[var(--text-secondary)]">Inbox</span>
            )}
          </div>
        )}
        <button
          ref={moreRef}
          type="button"
          aria-label={`${node.title} actions`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={openMenuAtButton}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-selected)] hover:text-[var(--text-primary)]"
        >
          <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      {node.children.map((child) => (
        <ProjectRow
          key={child.id}
          node={child}
          depth={depth + 1}
          inboxId={inboxId}
          menuOpenFor={menuOpenFor}
          renamingId={renamingId}
          onOpenMenu={onOpenMenu}
        />
      ))}
    </>
  )
}

function ArchivedRows({
  nodes,
  depth,
  menuOpenFor,
  onOpenMenu,
}: {
  nodes: ProjectTreeNode[]
  depth: number
  menuOpenFor: number | null
  onOpenMenu: OpenMenu
}) {
  const { restore } = useSharedProjectActions()
  return nodes.map((node) => (
    <ArchivedRow key={node.id} node={node} depth={depth} menuOpen={menuOpenFor === node.id} onOpenMenu={onOpenMenu} onRestore={() => restore(node)}>
      <ArchivedRows nodes={node.children} depth={depth + 1} menuOpenFor={menuOpenFor} onOpenMenu={onOpenMenu} />
    </ArchivedRow>
  ))
}

function ArchivedRow({
  node,
  depth,
  menuOpen,
  onOpenMenu,
  onRestore,
  children,
}: {
  node: ProjectTreeNode
  depth: number
  menuOpen: boolean
  onOpenMenu: OpenMenu
  onRestore: () => void
  children: React.ReactNode
}) {
  const moreRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <div
        className={cn('flex min-h-10 items-center gap-2 border-b border-border/60 pr-2', menuOpen && 'bg-[var(--bg-hover)]')}
        style={{ paddingLeft: `${16 + depth * 20}px` }}
        onContextMenu={(event) => {
          event.preventDefault()
          onOpenMenu(node, { point: { x: event.clientX, y: event.clientY } }, restoreRef.current)
        }}
      >
        <Folder aria-hidden="true" className="h-4 w-4 shrink-0 opacity-60" style={{ color: normalizeHex(node.hex_color) || 'var(--text-secondary)' }} />
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">{node.title}</span>
        <Button ref={restoreRef} variant="quiet" onClick={onRestore} aria-label={`Restore ${node.title}`}>
          <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
          Restore
        </Button>
        <button
          ref={moreRef}
          type="button"
          aria-label={`${node.title} actions`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => moreRef.current && onOpenMenu(node, { anchor: moreRef.current }, restoreRef.current)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-selected)] hover:text-[var(--text-primary)]"
        >
          <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      {children}
    </>
  )
}

function InboxCard() {
  const selectId = useId()
  const { data } = useProjects()
  const { data: config } = useAppConfig()
  const { setInbox } = useSharedProjectActions()
  const active = useMemo(() => data?.flat ?? [], [data?.flat])
  const options = useMemo(() => parentOptions(active, new Set()), [active])
  const inboxId = config?.inbox_project_id ?? 0
  const missing = inboxId !== 0 && data != null && !active.some((p) => p.id === inboxId)

  return (
    <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Inbox</h2>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">
        Tasks without a project land here. It shows as Inbox in the sidebar, not among the projects.
      </p>
      <label htmlFor={selectId} className="mb-1 block text-xs text-[var(--text-secondary)]">Inbox project</label>
      <select
        id={selectId}
        value={inboxId}
        onChange={(event) => {
          const project = active.find((p) => p.id === Number(event.target.value))
          if (project) void setInbox(project)
        }}
        className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
      >
        {(inboxId === 0 || missing) && <option value={inboxId}>Select a project...</option>}
        {options.map(({ project, depth }) => (
          <option key={project.id} value={project.id}>
            {'   '.repeat(depth)}
            {project.title}
          </option>
        ))}
      </select>
      {missing && (
        <p className="mt-1 text-xs text-danger">
          The configured Inbox project is archived or unavailable. Select an active project.
        </p>
      )}
    </div>
  )
}

function ProjectListCard() {
  const { data, isLoading, isFetching, error, refetch } = useProjects()
  const { data: config } = useAppConfig()
  const renaming = useProjectActionsStore((s) => s.renaming)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [menu, setMenu] = useState<{ project: Project; point?: { x: number; y: number }; opener: HTMLElement | null } | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const archivedTree = useMemo(() => buildProjectTree(data?.archived ?? []), [data?.archived])
  const inboxId = config?.inbox_project_id ?? 0
  const { setNodeRef: setRootRef } = useDroppable({ id: ROOT_ID, data: { type: 'project-root' } })
  const rootActive = useRootDropActive(ROOT_ID)

  useEffect(() => {
    void refetch()
  }, [refetch])

  const openMenu: OpenMenu = (project, at, opener) => {
    if ('anchor' in at) {
      anchorRef.current = at.anchor
      setMenu({ project, opener })
    } else {
      setMenu({ project, point: at.point, opener })
    }
  }
  const menuOpenFor = menu?.project.id ?? null
  const renamingId = renaming?.surface === 'settings' ? renaming.id : null
  const archivedCount = data?.archived.length ?? 0

  return (
    <div className="overflow-hidden rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)]">
      <div
        ref={setRootRef}
        className={cn('flex items-center gap-2 border-b border-[var(--border-color)] px-4 py-3', rootActive && INTO_CLASSES)}
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Projects</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            Drag a project to reorder it, or onto another project to put it inside. Right-click or use … for more.
          </p>
        </div>
        <button
          type="button"
          title="Refresh projects"
          aria-label="Refresh projects"
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-control p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
        >
          <RefreshCw aria-hidden="true" className={cn('h-4 w-4', isFetching && 'animate-spin')} />
        </button>
        <Button variant="primary" onClick={(event) => projectActions.openDialog({ kind: 'create', parentId: 0 }, event.currentTarget)}>
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          New project
        </Button>
      </div>

      {isLoading ? (
        <p className="px-4 py-5 text-sm text-[var(--text-secondary)]">Loading projects…</p>
      ) : error ? (
        <p className="px-4 py-5 text-sm text-danger">{error.message}</p>
      ) : data?.tree.length ? (
        data.tree.map((node) => (
          <ProjectRow
            key={node.id}
            node={node}
            depth={0}
            inboxId={inboxId}
            menuOpenFor={menuOpenFor}
            renamingId={renamingId}
            onOpenMenu={openMenu}
          />
        ))
      ) : (
        <p className="px-4 py-5 text-sm text-[var(--text-secondary)]">No active projects</p>
      )}

      {archivedCount > 0 && (
        <>
          <button
            type="button"
            aria-expanded={archivedOpen}
            onClick={() => setArchivedOpen((open) => !open)}
            className="flex w-full items-center gap-1.5 bg-[var(--bg-secondary)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn('h-3.5 w-3.5 transition-transform duration-fade-fast motion-reduce:transition-none', archivedOpen && 'rotate-90')}
            />
            Archived
            <span className="font-semibold normal-case tracking-normal">{archivedCount}</span>
          </button>
          {archivedOpen && <ArchivedRows nodes={archivedTree} depth={0} menuOpenFor={menuOpenFor} onOpenMenu={openMenu} />}
        </>
      )}

      {menu && (
        <ProjectMenu
          key={`${menu.project.id}:${menu.point ? `${menu.point.x}:${menu.point.y}` : 'button'}`}
          project={menu.project}
          surface="settings"
          anchorPoint={menu.point}
          anchorRef={menu.point ? undefined : anchorRef}
          opener={menu.opener}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

interface ProjectSettingsProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
}

/** Settings → Projects: the Inbox, the project list, how projects show in the sidebar, Review. */
export function ProjectSettings({ config, onChange }: ProjectSettingsProps) {
  return (
    <>
      <InboxCard />
      <ProjectListCard />

      <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Display</h2>
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={config.show_project_progress !== false}
            onChange={(event) => onChange({ show_project_progress: event.target.checked })}
          />
          <span className="text-sm text-[var(--text-primary)]">Show project progress in the sidebar</span>
        </label>
      </div>

      <ReviewSettingsPanel config={config} onChange={onChange} />
    </>
  )
}
