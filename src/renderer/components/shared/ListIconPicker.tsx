import { useRef } from 'react'
import { cn } from '@/lib/cn'
import { CUSTOM_LIST_ICONS, NONE_ICON_OPTION } from '@/lib/custom-list-icons'

interface ListIconPickerProps {
  value: string
  onChange: (key: string) => void
  labelledBy?: string
  /** Offers None first: the name alone, with no icon (cross-app semantics 3). */
  allowNone?: boolean
}

/** The step an arrow, Home or End key takes through [count] icons from [index], or null for another key. */
export function nextIconIndex(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * The custom list icons as a radio group of icon buttons, each named by its label. One tab stop:
 * the chosen icon (the first one when the stored key is unknown); the arrows move and choose.
 * A key this version does not offer (from a newer app) selects nothing and is kept until one is clicked.
 */
export function ListIconPicker({ value, onChange, labelledBy, allowNone = false }: ListIconPickerProps) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const icons = allowNone ? [NONE_ICON_OPTION, ...CUSTOM_LIST_ICONS] : CUSTOM_LIST_ICONS
  const selectedIndex = icons.findIndex((option) => option.key === value)
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    const next = nextIconIndex(event.key, index, icons.length)
    if (next === null) return
    event.preventDefault()
    onChange(icons[next].key)
    buttons.current[next]?.focus()
  }

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-wrap gap-1.5">
      {icons.map((option, index) => {
        const selected = index === selectedIndex
        const Icon = option.icon
        return (
          <button
            key={option.key}
            ref={(element) => { buttons.current[index] = element }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => onChange(option.key)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-control border transition-colors',
              selected
                ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
