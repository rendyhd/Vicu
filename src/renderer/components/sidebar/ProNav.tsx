import { useId } from 'react'
import { useNavigate, useMatches } from '@tanstack/react-router'
import { Briefcase, ChevronRight, Flag, Hourglass, Layers, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { SelectionPill } from './SelectionPill'
import { GroupNav } from './GroupNav'
import { usePro } from '@/hooks/use-pro'
import { useProSectionCollapsed } from '@/hooks/use-sidebar-collapsed'
import type { ProLayer } from '../../../shared/pro/settings'

export interface ProNavItem {
  id: string
  label: string
  path: string
  layer: ProLayer
  icon: LucideIcon
  /** The icon's colour class (design system 9: the same row anatomy as the smart lists). */
  tone: string
}

export const PRO_NAV_ITEMS: ProNavItem[] = [
  { id: 'flagged', label: 'Flagged', path: '/flagged', layer: 'availability', icon: Flag, tone: 'text-accent-orange' },
  { id: 'waiting-on', label: 'Waiting on', path: '/waiting-on', layer: 'promises', icon: Hourglass, tone: 'text-accent-teal' },
  { id: 'people', label: 'People', path: '/people', layer: 'promises', icon: Users, tone: 'text-accent-teal' },
  { id: 'portfolio', label: 'Portfolio', path: '/portfolio', layer: 'portfolio', icon: Layers, tone: 'text-accent-purple' },
  { id: 'sponsor', label: 'Sponsor desk', path: '/sponsor', layer: 'portfolio', icon: Briefcase, tone: 'text-accent-purple' },
]

/** The pages that exist in this build; a list is added here with its route. */
const BUILT = new Set(['flagged', 'waiting-on', 'people', 'portfolio', 'sponsor'])

/** The Pro lists that are on (the palette lists them too). Empty while Pro is off. */
export function useProNavItems(): ProNavItem[] {
  const pro = usePro()
  return pro.on ? PRO_NAV_ITEMS.filter((item) => BUILT.has(item.id) && pro.layer(item.layer)) : []
}

/**
 * Pro's sidebar section, between the smart lists and the projects unless the person moved it
 * (plan 7.9; Settings → General → Sidebar): a header that folds it away (per device,
 * `sidebar_pro_collapsed`) and its lists. Folded, the lists stay in the command palette. Nothing
 * while Pro is off.
 */
export function ProNav() {
  const navigate = useNavigate()
  const matches = useMatches()
  const currentPath = matches[matches.length - 1]?.pathname ?? ''
  const items = useProNavItems()
  const { collapsed, setCollapsed } = useProSectionCollapsed()
  const listId = useId()
  if (items.length === 0) return null
  return (
    <div className="px-2 pb-2" data-pro-nav>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={collapsed ? undefined : listId}
        onClick={() => setCollapsed(!collapsed)}
        className="flex h-6 w-full items-center gap-1 rounded-control px-2 text-left text-caption uppercase tracking-wider text-text-secondary transition-colors hover:bg-bg-hover hover:text-text"
      >
        {/* i18n-ignore: a product name */}
        <span>Pro</span>
        <ChevronRight
          aria-hidden="true"
          className={cn('h-3 w-3 shrink-0 transition-transform duration-fade-fast motion-reduce:transition-none', !collapsed && 'rotate-90')}
          strokeWidth={2}
        />
      </button>
      {!collapsed && (
        <nav id={listId} aria-label="Pro" className="mt-0.5 flex flex-col gap-0.5">
          {items.map((item) => {
            const isActive = currentPath === item.path || (item.id === 'people' && currentPath.startsWith('/person/'))
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate({ to: item.path })}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative flex h-8 items-center gap-2.5 rounded-control px-2.5 text-section font-medium text-text transition-colors',
                  !isActive && 'hover:bg-[var(--bg-hover)]',
                )}
              >
                <Icon className={cn('h-4 w-4', item.tone)} aria-hidden />
                <span className="flex-1 text-left">{item.label}</span>
                {isActive && <SelectionPill />}
              </button>
            )
          })}
          <GroupNav currentPath={currentPath} />
        </nav>
      )}
    </div>
  )
}
