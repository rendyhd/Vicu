import { useNavigate, useMatches } from '@tanstack/react-router'
import { cn } from '@/lib/cn'
import { SelectionPill } from './SelectionPill'
import { RollingCount } from '@/components/shared/RollingCount'
import { SmartListIcon } from '@/components/shared/SmartListIcon'
import type { SmartListId } from '@/lib/smart-list-identity'
import { useReviewBadgeCount, useReviewFeatureEnabled } from '@/hooks/use-review'
import { useAppConfig } from '@/hooks/use-app-config'
import { useOpenTaskCounts } from '@/hooks/use-project-progress'
import { useTodayOverdueCount } from '@/hooks/use-today-overdue-count'
import { isRoutinesEnabled } from '@/lib/vikunja-types'

export interface SmartListItem {
  id: SmartListId
  label: string
  path: string
}

// Icon and colour of each list come from the identity table (lib/smart-list-identity.ts).
const ALL_SMART_LISTS: SmartListItem[] = [
  { id: 'inbox', label: 'Inbox', path: '/inbox' },
  { id: 'today', label: 'Today', path: '/today' },
  { id: 'routines', label: 'Routines', path: '/routines' },
  { id: 'upcoming', label: 'Upcoming', path: '/upcoming' },
  { id: 'anytime', label: 'Anytime', path: '/anytime' },
  { id: 'review', label: 'Review', path: '/review' },
  { id: 'logbook', label: 'Logbook', path: '/logbook' },
]

/** The smart lists that are switched on (Review and Routines can be off). */
export function useSmartLists(): SmartListItem[] {
  const reviewEnabled = useReviewFeatureEnabled()
  const { data: config } = useAppConfig()
  const routinesEnabled = isRoutinesEnabled(config)

  return ALL_SMART_LISTS.filter((i) =>
    (i.id !== 'review' || reviewEnabled) && (i.id !== 'routines' || routinesEnabled))
}

export function SmartListNav() {
  const navigate = useNavigate()
  const matches = useMatches()
  const currentPath = matches[matches.length - 1]?.pathname ?? ''
  const reviewCount = useReviewBadgeCount()
  const items = useSmartLists()
  const { data: config } = useAppConfig()
  const openCounts = useOpenTaskCounts()
  const todayCount = useTodayOverdueCount()

  // Counts as in the sidebar mock: open tasks in the Inbox, due today or overdue, projects to review.
  const countOf = (id: SmartListId): number => {
    if (id === 'review') return reviewCount
    if (id === 'today') return todayCount ?? 0
    if (id === 'inbox') return config?.inbox_project_id ? (openCounts?.get(config.inbox_project_id) ?? 0) : 0
    return 0
  }

  return (
    <nav aria-label="Lists" className="flex flex-col gap-0.5 px-2 py-2">
      {items.map((item) => {
        const isActive = currentPath === item.path
        const isReview = item.id === 'review'
        const reviewActiveBorder = isReview && isActive && reviewCount > 0
        const count = countOf(item.id)
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate({ to: item.path })}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative flex h-8 items-center gap-2.5 rounded-control px-2.5 text-[13px] font-medium transition-colors',
              isActive
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
              reviewActiveBorder && 'border border-[rgba(175,82,222,0.4)]'
            )}
          >
            <SmartListIcon list={item.id} className="h-4 w-4" />
            <span className="flex-1 text-left">{item.label}</span>
            {count > 0 && (
              <RollingCount value={count} className="text-[11px] font-semibold text-[var(--text-secondary)]" />
            )}
            {isActive && <SelectionPill />}
          </button>
        )
      })}
    </nav>
  )
}
