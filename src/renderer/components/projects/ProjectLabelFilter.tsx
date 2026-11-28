import { forwardRef, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Filter } from 'lucide-react'
import { cn } from '@/lib/cn'
import { normalizeHex } from '@/lib/constants'
import { labelChipStyle } from '@/lib/label-style'
import { useIsDark } from '@/hooks/use-is-dark'
import type { Label } from '@/lib/vikunja-types'
import type { LabelChoice } from '../../../shared/project-label-filter'

/**
 * The filter button next to a project page's … button (cross-app semantics 17.2). It opens the bar
 * of labels; while labels are picked it is tinted and carries their number, also with the bar closed.
 */
export const LabelFilterButton = forwardRef<HTMLButtonElement, {
  picked: number
  open: boolean
  controls: string
  onToggle: () => void
}>(function LabelFilterButton({ picked, open, controls, onToggle }, ref) {
  const { t } = useTranslation()
  const name = picked > 0 ? t('projectFilter.buttonPicked', { count: picked }) : t('projectFilter.button')
  return (
    <button
      ref={ref}
      type="button"
      aria-label={name}
      title={t('projectFilter.button')}
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={onToggle}
      data-project-label-filter
      className={cn(
        'relative flex h-7 w-7 items-center justify-center rounded-control transition-colors duration-fade-fast hover:bg-bg-hover',
        picked > 0 ? 'text-accent-blue' : open ? 'bg-bg-hover text-text' : 'text-text-secondary hover:text-text',
      )}
    >
      <Filter aria-hidden="true" className="h-4 w-4" />
      {picked > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-accent-fill px-1 text-caption leading-none text-on-accent"
        >
          {picked}
        </span>
      )}
    </button>
  )
})

/** The bar under the header: one pill per label with its count, and Clear once something is picked. */
export function LabelFilterBar({
  id,
  choices,
  picked,
  onToggle,
  onClear,
  onClose,
}: {
  id: string
  choices: LabelChoice<Label>[]
  picked: readonly number[]
  onToggle: (labelId: number) => void
  onClear: () => void
  /** Escape: the bar closes and the focus goes back to the button. */
  onClose: () => void
}) {
  const { t } = useTranslation()
  const isDark = useIsDark()
  const first = useRef<HTMLButtonElement>(null)
  // Opening the bar from the button puts the focus on its first label.
  useEffect(() => {
    first.current?.focus()
  }, [])

  return (
    <div
      id={id}
      role="group"
      aria-label={t('projectFilter.bar')}
      data-project-label-bar
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      className="mx-6 mb-2 flex flex-wrap items-center gap-1.5 border-b border-border pb-2.5"
    >
      {choices.map(({ label, count }, index) => {
        const on = picked.includes(label.id)
        const dot = normalizeHex(label.hex_color)
        return (
          <button
            key={label.id}
            ref={index === 0 ? first : undefined}
            type="button"
            aria-pressed={on}
            aria-label={t('projectFilter.choice', { label: label.title, count })}
            onClick={() => onToggle(label.id)}
            style={on ? labelChipStyle(label.hex_color, isDark) : undefined}
            className={cn(
              'vicu-chip flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-meta transition-colors duration-fade-fast',
              on ? 'border-transparent font-medium' : 'border-border text-text-secondary hover:bg-bg-hover',
            )}
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: dot ?? 'var(--text-secondary)' }}
            />
            {/* The name read out starts with what is shown: "Errand 2 tasks". */}
            <span className="max-w-[12rem] truncate">{label.title}</span>{' '}
            <span aria-hidden="true" className="text-caption opacity-80">{count}</span>
          </button>
        )
      })}
      {picked.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto rounded-control px-1.5 py-0.5 text-meta font-medium text-accent-blue hover:bg-bg-hover"
        >
          {t('projectFilter.clear')}
        </button>
      )}
    </div>
  )
}

/** "3 more tasks in this project" with Show all, under the list while labels are picked. */
export function LabelFilterMore({ count, onShowAll }: { count: number; onShowAll: () => void }) {
  const { t } = useTranslation()
  if (count <= 0) return null
  return (
    <div className="mx-6 my-2 flex items-center gap-2 text-meta text-text-secondary" data-project-label-more>
      <span>{t('projectFilter.more', { count })}</span>
      <button
        type="button"
        onClick={onShowAll}
        className="rounded-control px-1.5 py-0.5 text-meta font-medium text-accent-blue hover:bg-bg-hover"
      >
        {t('projectFilter.showAll')}
      </button>
    </div>
  )
}
