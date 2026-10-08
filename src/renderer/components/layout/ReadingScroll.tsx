import { forwardRef, useImperativeHandle, useRef } from 'react'
import { cn } from '@/lib/cn'
import { useListMotion } from '@/hooks/use-list-motion'

interface ReadingScrollProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Classes for the reading column inside the scroll area (padding, flex layout). */
  columnClassName?: string
}

/**
 * The scroll area of a view: it spans the whole content region, so its scrollbar sits at the window
 * edge, and the content sits in the centred reading column (max-w-reading) inside it. The gutter is
 * always reserved, so the column does not shift between a short and a long list; PageHeader keeps the
 * same width clear on its right to line up with it. It also plays the motion of the rows inside it:
 * new rows open, removed rows close, reordered rows and the rows below a card move (use-list-motion).
 */
export const ReadingScroll = forwardRef<HTMLDivElement, ReadingScrollProps>(function ReadingScroll(
  { className, columnClassName, children, ...rest },
  ref,
) {
  const inner = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => inner.current as HTMLDivElement)
  useListMotion(inner)
  return (
    <div ref={inner} className={cn('min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]', className)} {...rest}>
      <div className={cn('mx-auto min-h-full w-full max-w-reading', columnClassName)}>{children}</div>
    </div>
  )
})
