import { cn } from '@/lib/cn'

interface ContentAreaProps {
  children: React.ReactNode
  className?: string
}

/**
 * The region right of the sidebar. It spans the whole width and holds no column itself: every view
 * puts its header in PageHeader and its list in ReadingScroll, which both centre their content in
 * the reading column (max-w-reading, 760 px), so a title, a row and an empty state start at the same
 * x on every page while the scrollbar stays at the window edge. It is the page's one `main` landmark.
 */
export function ContentArea({ children, className }: ContentAreaProps) {
  return (
    <main className={cn('flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-primary)]', className)}>
      {children}
    </main>
  )
}
