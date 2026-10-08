import { cn } from '@/lib/cn'

interface ContentAreaProps {
  children: React.ReactNode
  className?: string
}

/**
 * Every view sits in one centred reading column (max-w-reading, 760 px), so a title, a row and an
 * empty state start at the same x on every page. The area around the column keeps the page colour.
 */
export function ContentArea({ children, className }: ContentAreaProps) {
  return (
    <div className={cn('flex flex-1 flex-col overflow-hidden bg-[var(--bg-primary)]', className)}>
      <div className="flex min-h-0 w-full max-w-reading flex-1 flex-col self-center">{children}</div>
    </div>
  )
}
