import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import { cn } from '@/lib/cn'
import { INTO_CLASSES } from '@/components/projects/ProjectRowParts'
import { useCategoryDropActive } from '@/stores/project-drop-store'
import type { ProjectCategory } from '../../../shared/project-categories'

/** How a category header asks for its menu: at the pointer (right-click) or at its … button. */
export type OpenCategoryMenu = (
  category: ProjectCategory,
  at: { point: { x: number; y: number } } | { anchor: HTMLElement },
  opener: HTMLElement | null,
) => void

interface CategoryHeaderProps {
  category: ProjectCategory
  /** Its top-level projects: shown after the name while it is collapsed. */
  count: number
  collapsed: boolean
  onToggle: () => void
  onOpenMenu: OpenCategoryMenu
  menuOpen: boolean
}

/**
 * A category above its projects in the sidebar (cross-app semantics 13; design-system-v1 section
 * 5): the name as typed in the `group` size at medium weight and the secondary text colour, a
 * hairline above, a chevron after it. Quieter than the PROJECTS label above it. Collapsed, the
 * number of its projects follows the name. A click opens or closes it; a dragged project dropped
 * on it goes to the start of the category.
 */
export function CategoryHeader({ category, count, collapsed, onToggle, onOpenMenu, menuOpen }: CategoryHeaderProps) {
  const { t } = useTranslation()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const dndId = `project-category-sidebar-${category.id}`
  const { setNodeRef } = useDroppable({ id: dndId, data: { type: 'project-category', categoryId: category.id } })
  const dropActive = useCategoryDropActive(dndId)
  const openMenuAtButton = () => {
    if (moreRef.current) onOpenMenu(category, { anchor: moreRef.current }, toggleRef.current)
  }

  return (
    <div className="mt-1.5">
      {/* The hairline starts where the name does (design-system-v1 section 5). */}
      <div aria-hidden="true" className="mb-1.5 ml-7 mr-1.5 border-t border-border" />
      <div
        ref={setNodeRef}
        data-sidebar-category={category.id}
        className={cn(
          'group relative flex h-7 items-center rounded-control',
          dropActive ? INTO_CLASSES : 'hover:bg-[var(--bg-hover)]',
          menuOpen && !dropActive && 'bg-[var(--bg-hover)]',
        )}
        onContextMenu={(event) => {
          event.preventDefault()
          onOpenMenu(category, { point: { x: event.clientX, y: event.clientY } }, toggleRef.current)
        }}
      >
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={!collapsed}
          aria-label={t('projects.category.label', { name: category.name, count })}
          aria-keyshortcuts="Shift+F10"
          onClick={onToggle}
          onKeyDown={(event) => {
            if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
              event.preventDefault()
              openMenuAtButton()
            }
          }}
          className="flex h-full min-w-0 flex-1 items-center gap-1 rounded-control pl-7 pr-1 text-left text-group font-medium text-text-secondary hover:text-text"
        >
          <span className="min-w-0 truncate">{category.name}</span>
          {collapsed && <span aria-hidden="true" className="shrink-0">· {count}</span>}
          <ChevronRight
            aria-hidden="true"
            className={cn('h-3 w-3 shrink-0 transition-transform duration-fade-fast motion-reduce:transition-none', !collapsed && 'rotate-90')}
            strokeWidth={2}
          />
        </button>
        <button
          ref={moreRef}
          type="button"
          tabIndex={-1}
          aria-label={t('projects.category.actions', { name: category.name })}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={openMenuAtButton}
          className={cn(
            'mx-1.5 h-5 w-5 shrink-0 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-selected)] hover:text-[var(--text-primary)]',
            menuOpen ? 'flex' : 'hidden group-hover:flex group-focus-within:flex',
          )}
        >
          <MoreHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
