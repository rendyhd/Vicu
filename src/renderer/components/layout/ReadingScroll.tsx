import { forwardRef } from 'react'
import { cn } from '@/lib/cn'

interface ReadingScrollProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Classes for the reading column inside the scroll area (padding, flex layout). */
  columnClassName?: string
}

/**
 * The scroll area of a view: it spans the whole content region, so its scrollbar sits at the window
 * edge, and the content sits in the centred reading column (max-w-reading) inside it. The gutter is
 * always reserved, so the column does not shift between a short and a long list; PageHeader keeps the
 * same width clear on its right to line up with it.
 */
export const ReadingScroll = forwardRef<HTMLDivElement, ReadingScrollProps>(function ReadingScroll(
  { className, columnClassName, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={cn('min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]', className)} {...rest}>
      <div className={cn('mx-auto min-h-full w-full max-w-reading', columnClassName)}>{children}</div>
    </div>
  )
})
