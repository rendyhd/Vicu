import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import type { TokenType } from '@/lib/task-parser'
import { parseChips, type ChipData } from '@/lib/parse-chips'
import { motionMs, motionSpringCurve, travelStart } from '@/lib/motion'
import { readReducedMotion } from '@/hooks/use-reduced-motion'
import { priorityMark } from '../../../shared/priority-mark-svg'
import { TOKEN_CHIP_CLASSES } from '@/lib/token-chip-colors'

// Green=date, orange=label, blue=project, purple=recurrence, as roles of the design tokens
// (lib/token-chip-colors.ts). A priority chip takes the colour role of its level (the same as the
// priority mark and Quick Entry's chip).
const chipStyles: Record<string, string> = { ...TOKEN_CHIP_CLASSES, priority: '' }

export type { ChipData }

/** Convert a ParseResult into a flat array of chip descriptors. */
export const buildChips = parseChips

/** The role colour of a priority chip: a tint of the level's colour with the colour as text. */
function priorityStyle(priority: number | undefined): CSSProperties | undefined {
  const cssVar = priorityMark(priority)?.cssVar
  if (!cssVar) return undefined
  return { background: `rgb(var(${cssVar}-rgb) / 0.12)`, color: `var(${cssVar})` }
}

interface TokenChipProps {
  type: TokenType
  label: string
  /** Where the value came from: the typed text, or a control the user used. */
  source?: ChipData['source']
  priority?: number
  onDismiss?: () => void
}

export function TokenChip({ type, label, source, priority, onDismiss }: TokenChipProps) {
  const ref = useRef<HTMLSpanElement>(null)

  // A chip read from the typed text travels out of the highlighted token (card 4.11a); under reduced
  // motion it fades in. Only when it first appears: later edits of the text keep the chip where it is.
  useLayoutEffect(() => {
    const chip = ref.current
    if (!chip || source !== 'text' || typeof chip.animate !== 'function') return
    if (readReducedMotion()) {
      chip.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motionMs('fade-fast'), easing: 'linear' })
      return
    }
    const token = chip.closest('[data-token-scope]')?.querySelector<HTMLElement>(`[data-token-type="${type}"]`)
    if (!token) {
      chip.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motionMs('fade-fast'), easing: 'linear' })
      return
    }
    const from = travelStart(token.getBoundingClientRect(), chip.getBoundingClientRect())
    chip.animate(
      [
        { transform: `translate(${from.dx}px, ${from.dy}px) scale(${from.scale})`, opacity: 0.4 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: motionMs('move'), easing: motionSpringCurve('move') },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <span
      ref={ref}
      data-chip-type={type}
      data-chip-source={source}
      style={type === 'priority' ? priorityStyle(priority) : undefined}
      className={`vicu-chip group inline-flex items-center gap-0.5 rounded-chip px-2 py-0.5 text-[11px] font-medium leading-snug ${chipStyles[type] ?? ''}`}
    >
      {label}
      {onDismiss && (
        <button
          type="button"
          className="ml-0.5 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss()
          }}
          aria-label={`Dismiss ${type}`}
        >
          &times;
        </button>
      )}
    </span>
  )
}
