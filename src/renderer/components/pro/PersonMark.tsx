import { useIsDark } from '@/hooks/use-is-dark'
import { labelChipStyle } from '@/lib/label-style'
import { cn } from '@/lib/cn'

/** Initials of a person's name: the first letters of the first and last words. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0][0] ?? ''
  const last = words.length > 1 ? words[words.length - 1][0] ?? '' : ''
  return (first + last).toUpperCase()
}

/**
 * A person's mark (design system 9): a circle with their initials where a promise of theirs has its
 * checkbox, because it is not yours to tick. A button that opens the verdicts.
 */
export function PersonMark({ name, color, onClick, expanded, className }: {
  name: string
  color?: string
  onClick?: () => void
  expanded?: boolean
  className?: string
}) {
  // The label's own colour, as its chips draw it (contrast-checked for the theme).
  const isDark = useIsDark()
  const style = color ? labelChipStyle(color, isDark) : undefined
  const content = initialsOf(name)
  if (!onClick) {
    return (
      <span role="img" aria-label={name} style={style} className={cn('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-teal/20 text-chip font-semibold leading-none tracking-tight text-accent-teal', className)}>
        {content}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      aria-label={`${name}'s promise: give a verdict`}
      aria-expanded={expanded}
      style={style}
      data-pro-person-mark
      className={cn('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-teal/20 text-chip font-semibold leading-none tracking-tight text-accent-teal hover:ring-2 hover:ring-accent-teal/40', className)}
    >
      {content}
    </button>
  )
}
