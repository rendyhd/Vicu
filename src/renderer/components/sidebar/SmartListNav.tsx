import { useNavigate, useMatches } from '@tanstack/react-router'
import { Inbox, Sun, Calendar, Layers, BookOpen } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { LucideIcon } from 'lucide-react'

interface SmartListItem {
  id: string
  label: string
  icon: LucideIcon
  path: string
  iconColor: string
}

const smartLists: SmartListItem[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox, path: '/inbox', iconColor: 'text-accent-blue' },
  { id: 'today', label: 'Today', icon: Sun, path: '/today', iconColor: 'text-accent-red' },
  { id: 'upcoming', label: 'Upcoming', icon: Calendar, path: '/upcoming', iconColor: 'text-accent-orange' },
  { id: 'anytime', label: 'Anytime', icon: Layers, path: '/anytime', iconColor: 'text-[#5AC8FA]' },
  { id: 'logbook', label: 'Logbook', icon: BookOpen, path: '/logbook', iconColor: 'text-accent-green' },
]

export function SmartListNav() {
  const navigate = useNavigate()
  const matches = useMatches()
  const currentPath = matches[matches.length - 1]?.pathname ?? ''

  return (
    <nav className="flex flex-col gap-0.5 px-2 py-2">
      {smartLists.map((item) => {
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
          </button>
        )
      })}
    </nav>
  )
}
