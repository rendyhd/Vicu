import { PageHeader } from './PageHeader'
import { ReadingScroll } from '@/components/layout/ReadingScroll'
import { SmartListIcon } from './SmartListIcon'
import type { SmartListId } from '@/lib/smart-list-identity'

interface ListSkeletonProps {
  title: string
  subtitle?: React.ReactNode
  /** A smart list: its icon shows before the title, as it will on the real page. */
  identity?: SmartListId
  /** How many placeholder rows to show (3 or 4). */
  rows?: 3 | 4
}

// Title widths differ from row to row so the block reads as text and not as a table.
const TITLE_WIDTHS = ['w-3/5', 'w-2/5', 'w-1/2', 'w-1/3'] as const

/**
 * What a list view shows while its tasks load: the real page header (so the title does not jump) and
 * a few placeholder rows shaped like task rows. A light sweeps across them once (`vicu-shimmer`); reduced motion fades them in instead.
 */
export function ListSkeleton({ title, subtitle, identity, rows = 4 }: ListSkeletonProps) {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <PageHeader title={title} subtitle={subtitle} icon={identity && <SmartListIcon list={identity} className="h-5 w-5" />} />
      <ReadingScroll>
        <div role="status" aria-label={`Loading ${title}`} data-skeleton="list">
          {TITLE_WIDTHS.slice(0, rows).map((width) => (
            <div key={width} data-skeleton-row className="flex items-center gap-3 border-b border-[var(--border-color)] px-4 py-2.5" aria-hidden="true">
              <span className="vicu-shimmer h-5 w-5 shrink-0 rounded-full bg-bg-hover" />
              <span className={`vicu-shimmer h-3.5 rounded-control bg-bg-hover ${width}`} />
            </div>
          ))}
        </div>
      </ReadingScroll>
    </div>
  )
}
