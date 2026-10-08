import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { normalizeHex } from '@/lib/constants'

// The header of a group of tasks in a list view (design review D-4). Two levels:
//   level 1 (Overdue, Today, a day, a project at the top of a list): 13/600, sentence case, with the
//     count of open tasks; Overdue in the overdue colour.
//   level 2 (a project inside a level 1 group): 12/600 with the project colour dot.
// Both stick to the top of the scroll area while their group is on screen; level 2 sticks below
// level 1. (The hairline under a stuck header is a later card.)

export type ListSectionTone = 'default' | 'overdue' | 'routines'

/** Height of a level 1 header; a level 2 header sticks this far from the top. */
const LEVEL_1_HEIGHT = 'h-8'
const LEVEL_2_TOP = 'top-8'

const TONE_CLASS: Record<ListSectionTone, string> = {
  default: 'text-text',
  overdue: 'text-status-overdue',
  routines: 'text-accent-purple',
}

interface ListSectionHeaderProps {
  level: 1 | 2
  title: string
  /** Open tasks in the group; left out where the number would be partial (a list that pages in). */
  count?: number
  /** A project colour (`#RRGGBB`); shows as a dot before the title. */
  dotColor?: string
  tone?: ListSectionTone
  /** Stays at the top while the group scrolls; on by default. */
  sticky?: boolean
  className?: string
  /** Extra content after the count (the routines progress bar). */
  children?: ReactNode
}

export function ListSectionHeader({
  level,
  title,
  count,
  dotColor,
  tone = 'default',
  sticky = true,
  className,
  children,
}: ListSectionHeaderProps) {
  const dot = level === 2 || dotColor !== undefined
  const color = normalizeHex(dotColor)
  const Heading = level === 1 ? 'h2' : 'h3'
  return (
    <div
      className={cn(
        'z-10 flex items-center gap-2 bg-bg-page px-6',
        level === 1 ? cn(LEVEL_1_HEIGHT, 'text-section') : 'h-7 text-group',
        level === 1 ? TONE_CLASS[tone] : 'text-text-secondary',
        sticky && (level === 1 ? 'sticky top-0' : cn('sticky', LEVEL_2_TOP)),
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color ?? 'var(--text-tertiary)' }}
        />
      )}
      <Heading className="min-w-0 truncate">{title}</Heading>
      {count !== undefined && (
        <span className="shrink-0 font-medium tabular-nums text-text-secondary">{count}</span>
      )}
      {children}
    </div>
  )
}
