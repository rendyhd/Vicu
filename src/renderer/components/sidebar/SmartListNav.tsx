import { useNavigate, useMatches } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../../shared/i18n'
import { cn } from '@/lib/cn'
import { SelectionPill } from './SelectionPill'
import { RollingCount } from '@/components/shared/RollingCount'
import { SmartListIcon } from '@/components/shared/SmartListIcon'
import type { SmartListId } from '@/lib/smart-list-identity'
import { useReviewBadgeCount, useReviewFeatureEnabled } from '@/hooks/use-review'
import { useAppConfig } from '@/hooks/use-app-config'
import { useOpenTaskCounts } from '@/hooks/use-project-progress'
import { useTodayOverdueCount } from '@/hooks/use-today-overdue-count'
import { isHiddenFromSidebar, isPlannerEnabled, isRoutinesEnabled } from '@/lib/vikunja-types'

export interface SmartListItem {
  id: SmartListId
  label: string
  path: string
}

// Icon and colour of each list come from the identity table (lib/smart-list-identity.ts). The
// name is a catalog key, translated where the list is shown (never at module scope).
const ALL_SMART_LISTS: { id: SmartListId; name: TranslationKey; path: string }[] = [
  { id: 'inbox', name: 'nav.inbox', path: '/inbox' },
  { id: 'today', name: 'nav.today', path: '/today' },
  { id: 'plan', name: 'nav.plan', path: '/plan' },
  { id: 'routines', name: 'nav.routines', path: '/routines' },
  { id: 'upcoming', name: 'nav.upcoming', path: '/upcoming' },
  { id: 'anytime', name: 'nav.anytime', path: '/anytime' },
  { id: 'review', name: 'nav.review', path: '/review' },
  { id: 'logbook', name: 'nav.logbook', path: '/logbook' },
]

/**
 * The smart lists that are switched on (Review and Routines can be off). The command palette lists
 * them all; the sidebar leaves out the ones hidden in Settings → General → Sidebar. Their labels
 * are in the language in use.
 */
export function useSmartLists(): SmartListItem[] {
  const { t } = useTranslation()
  const reviewEnabled = useReviewFeatureEnabled()
  const { data: config } = useAppConfig()
  const routinesEnabled = isRoutinesEnabled(config)
  const plannerEnabled = isPlannerEnabled(config)

  return ALL_SMART_LISTS
    .filter((i) =>
      (i.id !== 'review' || reviewEnabled) && (i.id !== 'routines' || routinesEnabled) && (i.id !== 'plan' || plannerEnabled))
    .map((i) => ({ id: i.id, label: t(i.name), path: i.path }))
}

export function SmartListNav() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const matches = useMatches()
  const currentPath = matches[matches.length - 1]?.pathname ?? ''
  const reviewCount = useReviewBadgeCount()
  const { data: config } = useAppConfig()
  const items = useSmartLists().filter((item) => !isHiddenFromSidebar(config, item.id))
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
    <nav aria-label={t('nav.lists')} className="flex flex-col gap-0.5 px-2 py-2">
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
              reviewActiveBorder && 'border border-accent-purple/40'
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
