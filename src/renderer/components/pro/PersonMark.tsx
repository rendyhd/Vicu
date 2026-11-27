import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  // The label's own colour, as its chips draw it (contrast-checked for the theme).
  const isDark = useIsDark()
  const style = color ? labelChipStyle(color, isDark) : undefined
  // The initials are drawn by CSS from the attribute: they are decoration next to the name the mark
  // is labelled with, and text inside would have to be part of that name.
  const initials = initialsOf(name)
  const drawn = 'before:content-[attr(data-initials)]'
  if (!onClick) {
    return (
      <span role="img" aria-label={name} style={style} data-initials={initials} className={cn(drawn, 'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-blue/12 text-chip font-semibold leading-none tracking-tight text-accent-blue', className)} />
    )
  }
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      aria-label={t('pro.personMark.verdict', { name })}
      aria-expanded={expanded}
      style={style}
      data-pro-person-mark
      data-initials={initials}
      className={cn(drawn, 'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-blue/12 text-chip font-semibold leading-none tracking-tight text-accent-blue hover:ring-2 hover:ring-accent-blue/40', className)}
    />
  )
}
