import { useNavigate, useMatches } from '@tanstack/react-router'
import { Briefcase, Flag, Hourglass, Layers, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { SelectionPill } from './SelectionPill'
import { usePro } from '@/hooks/use-pro'
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
const BUILT = new Set(['flagged', 'waiting-on', 'people'])

/** The Pro lists that are on (the palette lists them too). Empty while Pro is off. */
export function useProNavItems(): ProNavItem[] {
  const pro = usePro()
  return pro.on ? PRO_NAV_ITEMS.filter((item) => BUILT.has(item.id) && pro.layer(item.layer)) : []
}

/** Pro's sidebar section, between the smart lists and the projects (plan 7.9). Nothing while Pro is off. */
export function ProNav() {
  const navigate = useNavigate()
  const matches = useMatches()
  const currentPath = matches[matches.length - 1]?.pathname ?? ''
  const items = useProNavItems()
  if (items.length === 0) return null
  return (
    <nav aria-label="Pro" className="flex flex-col gap-0.5 px-2 pb-2" data-pro-nav>
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
    </nav>
  )
}
