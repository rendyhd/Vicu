import { Fragment, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight, FolderOpen, MoreHorizontal, RotateCcw } from 'lucide-react'
import { buildProjectTree, useProjects, type ProjectTreeNode } from '@/hooks/use-projects'
import { useOpenTaskCounts } from '@/hooks/use-project-progress'
import { useCollapsedCategories, useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed'
import { useProjectCategories } from '@/hooks/use-project-categories'
import { useAppConfig } from '@/hooks/use-app-config'
import { useSharedProjectActions } from '@/hooks/use-project-actions'
import { cn } from '@/lib/cn'
import { normalizeHex } from '@/lib/constants'
import { ProjectMenu } from '@/components/projects/ProjectMenu'
import { CategoryMenu } from '@/components/projects/CategoryMenu'
import { ProjectCreateRow } from '@/components/projects/ProjectRowParts'
import { useProjectActionsStore } from '@/stores/project-actions-store'
import { useSidebarStore } from '@/stores/sidebar-store'
import { ProjectTreeItem, type OpenProjectMenu } from './ProjectTreeItem'
import { CategoryHeader, type OpenCategoryMenu } from './CategoryHeader'
import type { Project } from '@/lib/vikunja-types'
import type { ProjectCategory } from '../../../shared/project-categories'
import { useProjectsWithoutIcon } from '@/hooks/use-project-icons'

interface MenuState {
  project: Project
  point?: { x: number; y: number }
  anchor?: HTMLElement
  /** The row it came from: a dialog or confirmation the menu opens gives focus back here. */
  opener: HTMLElement | null
}

interface CategoryMenuState {
  category: ProjectCategory
  point?: { x: number; y: number }
  opener: HTMLElement | null
}

function flatten(nodes: ProjectTreeNode[], depth = 0): { node: ProjectTreeNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)])
}

/** Archived projects, collapsed at the end of the tree: open one to look at it, restore it here. */
function ArchivedGroup({
  archived,
  onOpenMenu,
  menuOpenFor,
}: {
  archived: Project[]
  onOpenMenu: (project: Project, at: { point: { x: number; y: number } } | { anchor: HTMLElement }, opener: HTMLElement | null) => void
  menuOpenFor: number | null
}) {
  const navigate = useNavigate()
  const open = useSidebarStore((s) => s.archivedProjectsOpen)
  const setOpen = useSidebarStore((s) => s.setArchivedProjectsOpen)
  const { restore } = useSharedProjectActions()
  const rows = useMemo(() => flatten(buildProjectTree(archived)), [archived])

  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-full items-center rounded-control pl-1 text-left text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center">
          <ChevronRight
            aria-hidden="true"
            className={cn('h-3 w-3 transition-transform duration-fade-fast motion-reduce:transition-none', open && 'rotate-90')}
            strokeWidth={2}
          />
        </span>
        Archived
        <span className="ml-1.5 font-semibold normal-case tracking-normal">{archived.length}</span>
      </button>
      {open &&
        rows.map(({ node, depth }) => (
          <ArchivedRow
            key={node.id}
            project={node}
            depth={depth}
            menuOpen={menuOpenFor === node.id}
            onOpen={() => navigate({ to: '/project/$projectId', params: { projectId: String(node.id) } })}
            onRestore={() => restore(node)}
            onOpenMenu={onOpenMenu}
          />
        ))}
    </div>
  )
}

function ArchivedRow({
  project,
  depth,
  menuOpen,
  onOpen,
  onRestore,
  onOpenMenu,
}: {
  project: Project
  depth: number
  menuOpen: boolean
  onOpen: () => void
  onRestore: () => void
  onOpenMenu: (project: Project, at: { point: { x: number; y: number } } | { anchor: HTMLElement }, opener: HTMLElement | null) => void
}) {
  const rowRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const color = normalizeHex(project.hex_color)
  const showIcon = !useProjectsWithoutIcon().has(project.id)
  const openMenuAtButton = () => {
    if (moreRef.current) onOpenMenu(project, { anchor: moreRef.current }, rowRef.current)
  }

  return (
    <div
      className={cn('group relative flex h-7 items-center rounded-control hover:bg-[var(--bg-hover)]', menuOpen && 'bg-[var(--bg-hover)]')}
      style={{ paddingLeft: `${depth * 16 + 4}px` }}
      onContextMenu={(event) => {
        event.preventDefault()
        onOpenMenu(project, { point: { x: event.clientX, y: event.clientY } }, rowRef.current)
      }}
    >
      <span aria-hidden className="w-6 shrink-0" />
      <button
        ref={rowRef}
        type="button"
        onClick={onOpen}
        onKeyDown={(event) => {
          if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
            event.preventDefault()
            openMenuAtButton()
          }
        }}
        className="flex h-full min-w-0 flex-1 items-center text-left"
      >
        {showIcon && <FolderOpen aria-hidden="true" className="mr-2 h-3.5 w-3.5 shrink-0 opacity-60" style={{ color: color || 'var(--text-secondary)' }} strokeWidth={1.8} />}
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-secondary)]">
          {project.title}
          <span className="sr-only"> (archived)</span>
        </span>
      </button>
      <span className={cn('mx-1.5 items-center gap-0.5', menuOpen ? 'flex' : 'hidden group-hover:flex group-focus-within:flex')}>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Restore ${project.title}`}
          title="Restore"
          onClick={onRestore}
          className="flex h-5 w-5 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-selected)] hover:text-[var(--accent-blue)]"
        >
          <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
        <button
          ref={moreRef}
          type="button"
          tabIndex={-1}
          aria-label={`${project.title} actions`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={openMenuAtButton}
          className="flex h-5 w-5 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-selected)] hover:text-[var(--text-primary)]"
        >
          <MoreHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  )
}

export function ProjectTree() {
  const { data, isLoading } = useProjects()
  const openCounts = useOpenTaskCounts()
  const { collapsed, setCollapsed } = useSidebarCollapsed()
  const { collapsed: collapsedCategories, setCollapsed: setCategoryCollapsed } = useCollapsedCategories()
  const { categories, layout } = useProjectCategories()
  const renaming = useProjectActionsStore((s) => s.renaming)
  const creating = useProjectActionsStore((s) => s.creating)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [categoryMenu, setCategoryMenu] = useState<CategoryMenuState | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const categoryAnchorRef = useRef<HTMLElement | null>(null)

  // The tree waits for the config so the Inbox is never drawn (and counted) for a moment.
  const { data: config, isLoading: configLoading } = useAppConfig()
  const showProgress = config?.show_project_progress !== false
  const showCount = config?.show_project_task_count === true

  // The top-level projects come from the category layout (cross-app semantics 13.2: the Inbox's
  // subprojects are top-level too), each drawn with its subtree.
  const nodesById = useMemo(() => new Map(flatten(data?.tree ?? []).map(({ node }) => [node.id, node])), [data?.tree])
  const groups = useMemo(
    () => layout.map((group) => ({
      category: group.category,
      nodes: group.projectIds.flatMap((id) => nodesById.get(id) ?? []),
    })),
    [layout, nodesById],
  )
  const archived = data?.archived ?? []

  const openMenu = (project: Project, at: { point: { x: number; y: number } } | { anchor: HTMLElement }, opener: HTMLElement | null) => {
    if ('anchor' in at) {
      anchorRef.current = at.anchor
      setMenu({ project, anchor: at.anchor, opener })
    } else {
      setMenu({ project, point: at.point, opener })
    }
  }
  const openTreeMenu: OpenProjectMenu = (node, at, opener) => openMenu(node, at, opener)
  const openCategoryMenu: OpenCategoryMenu = (category, at, opener) => {
    if ('anchor' in at) {
      categoryAnchorRef.current = at.anchor
      setCategoryMenu({ category, opener })
    } else {
      setCategoryMenu({ category, point: at.point, opener })
    }
  }

  if (isLoading || configLoading || !data) {
    return <div className="px-4 py-2 text-xs text-[var(--text-secondary)]">Loading...</div>
  }

  const renamingId = renaming?.surface === 'sidebar' ? renaming.id : null
  const menuOpenFor = menu?.project.id ?? null

  const projectItem = (node: (typeof groups)[number]['nodes'][number]) => (
    <ProjectTreeItem
      key={node.id}
      node={node}
      openCounts={openCounts}
      showProgress={showProgress}
      showCount={showCount}
      collapsed={collapsed}
      onToggleCollapsed={setCollapsed}
      onOpenMenu={openTreeMenu}
      menuOpenFor={menuOpenFor}
      renamingId={renamingId}
      creatingUnder={creating?.parentId ?? null}
    />
  )
  const noProjects = groups.every((group) => group.nodes.length === 0) && categories.length === 0

  return (
    <>
      <div className="flex flex-col gap-0.5 px-2">
        {noProjects && creating?.parentId !== 0 && (
          <div className="px-2 py-2 text-xs text-[var(--text-secondary)]">No projects</div>
        )}
        {groups.map(({ category, nodes }) => {
          if (!category) return <Fragment key="no-category">{nodes.map(projectItem)}</Fragment>
          const categoryCollapsed = collapsedCategories.has(category.id)
          return (
            <Fragment key={category.id}>
              <CategoryHeader
                category={category}
                count={nodes.length}
                collapsed={categoryCollapsed}
                onToggle={() => setCategoryCollapsed(category.id, !categoryCollapsed)}
                onOpenMenu={openCategoryMenu}
                menuOpen={categoryMenu?.category.id === category.id}
              />
              {!categoryCollapsed && nodes.map(projectItem)}
            </Fragment>
          )
        })}
        {creating?.parentId === 0 && <ProjectCreateRow parentId={0} depth={0} />}
        {archived.length > 0 && <ArchivedGroup archived={archived} onOpenMenu={openMenu} menuOpenFor={menuOpenFor} />}
      </div>

      {/* The project menu: the Menu primitive at the pointer or at the … button (arrow keys,
          Escape, focus return, kept in the window). */}
      {menu && (
        <ProjectMenu
          key={`${menu.project.id}:${menu.point ? `${menu.point.x}:${menu.point.y}` : 'button'}`}
          project={menu.project}
          surface="sidebar"
          anchorPoint={menu.point}
          anchorRef={menu.anchor ? anchorRef : undefined}
          opener={menu.opener}
          onClose={() => setMenu(null)}
        />
      )}
      {categoryMenu && (
        <CategoryMenu
          key={`${categoryMenu.category.id}:${categoryMenu.point ? `${categoryMenu.point.x}:${categoryMenu.point.y}` : 'button'}`}
          category={categoryMenu.category}
          index={categories.findIndex((category) => category.id === categoryMenu.category.id)}
          count={categories.length}
          anchorPoint={categoryMenu.point}
          anchorRef={categoryMenu.point ? undefined : categoryAnchorRef}
          opener={categoryMenu.opener}
          onClose={() => setCategoryMenu(null)}
        />
      )}
    </>
  )
}
