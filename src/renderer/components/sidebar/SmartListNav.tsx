import { useNavigate, useMatches } from '@tanstack/react-router'
import { Inbox, Sun, Calendar, Layers, BookOpen, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { LucideIcon } from 'lucide-react'
import { useReviewBadgeCount, useReviewFeatureEnabled } from '@/hooks/use-review'

interface SmartListItem {
  id: string
  label: string
  icon: LucideIcon
  path: string
  iconColor: string
}

const ALL_SMART_LISTS: SmartListItem[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox, path: '/inbox', iconColor: 'text-accent-blue' },
  { id: 'today', label: 'Today', icon: Sun, path: '/today', iconColor: 'text-accent-red' },
  { id: 'upcoming', label: 'Upcoming', icon: Calendar, path: '/upcoming', iconColor: 'text-accent-orange' },
  { id: 'anytime', label: 'Anytime', icon: Layers, path: '/anytime', iconColor: 'text-[#5AC8FA]' },
  { id: 'review', label: 'Review', icon: RefreshCw, path: '/review', iconColor: 'text-violet-500' },
  { id: 'logbook', label: 'Logbook', icon: BookOpen, path: '/logbook', iconColor: 'text-accent-green' },
]

export function SmartListNav() {
  const navigate = useNavigate()
  const matches = useMatches()
  const currentPath = matches[matches.length - 1]?.pathname ?? ''
  const reviewEnabled = useReviewFeatureEnabled()

  const items = reviewEnabled
    ? ALL_SMART_LISTS
    : ALL_SMART_LISTS.filter((i) => i.id !== 'review')

  return (
    <nav className="flex flex-col gap-0.5 px-2 py-2">
      {items.map((item) => {
        const isActive = currentPath === item.path
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate({ to: item.path })}
            className={cn(
              'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
              isActive
                ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
                : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            )}
          >
            <item.icon className={cn('h-4 w-4 shrink-0', item.iconColor)} strokeWidth={1.8} />
            <span className="flex-1 text-left">{item.label}</span>
            {item.id === 'review' ? <ReviewBadge /> : null}
          </button>
        )
      })}
    </nav>
  )
}

function ReviewBadge() {
  const count = useReviewBadgeCount()
  if (count <= 0) return null
  return (
    <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-medium bg-violet-500/20 text-violet-500">
      {count}
    </span>
  )
}
