import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { normalizeHex } from '@/lib/constants'
import { RollingCount } from '@/components/shared/RollingCount'

// The header of a group of tasks in a list view (design review D-4). Two levels:
//   level 1 (Overdue, Today, a day, a project at the top of a list): 13/600, sentence case, with the
//     count of open tasks; Overdue in the overdue colour.
//   level 2 (a project inside a level 1 group): 12/600 with the project colour dot.
// Both stick to the top of the scroll area while their group is on screen; level 2 sticks below
// level 1. A hairline appears under a header while it is stuck (card 4.11a): a one pixel sentinel
// above the header leaves the scroll area, an IntersectionObserver reports it, no scroll listener.

export type ListSectionTone = 'default' | 'overdue' | 'routines'

/** Height of a level 1 header; a level 2 header sticks this far from the top. */
const LEVEL_1_HEIGHT = 'h-8'
const LEVEL_2_TOP = 'top-8'
/** Level 2 sticks 32 px (LEVEL_2_TOP) below the top; its sentinel is judged against that line. */
const LEVEL_2_OFFSET_PX = 32

/** Whether the sentinel has scrolled above the line where the header sticks. */
function useStuck(sticky: boolean, offsetPx: number) {
  const sentinel = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = sentinel.current
    if (!sticky || !el || typeof IntersectionObserver === 'undefined') return
    const root = el.closest<HTMLElement>('.overflow-y-auto')
    const observer = new IntersectionObserver(
      ([entry]) => {
        const rootTop = entry.rootBounds?.top ?? 0
        setStuck(!entry.isIntersecting && entry.boundingClientRect.top < rootTop + offsetPx)
      },
      { root, rootMargin: `-${offsetPx}px 0px 0px 0px`, threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [sticky, offsetPx])
  return { sentinel, stuck }
}

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
  const { sentinel, stuck } = useStuck(sticky, level === 1 ? 0 : LEVEL_2_OFFSET_PX)
  return (
    <>
    {sticky && <div ref={sentinel} aria-hidden="true" className="-mb-px h-px" />}
    <div
      data-stuck={stuck ? '' : undefined}
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
        <RollingCount value={count} className="shrink-0 font-medium text-text-secondary" />
      )}
      {children}
      {sticky && <span aria-hidden="true" className="vicu-hairline pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[var(--border-color)]" />}
    </div>
    </>
  )
}
