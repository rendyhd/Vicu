import type { CSSProperties } from 'react'
import type { TokenType } from '@/lib/task-parser'
import { parseChips, type ChipData } from '@/lib/parse-chips'
import { priorityMark } from '../../../shared/priority-mark-svg'

// Match Quick Entry colors: green=date, orange=label, blue=project, purple=recurrence. A priority
// chip takes the colour role of its level (the same as the priority mark and Quick Entry's chip).
const chipStyles: Record<string, string> = {
  date: 'bg-[rgba(34,197,94,0.12)] text-[#16a34a] dark:bg-[rgba(34,197,94,0.2)] dark:text-[#4ade80]',
  priority: '',
  label: 'bg-[rgba(249,115,22,0.12)] text-[#ea580c] dark:bg-[rgba(249,115,22,0.2)] dark:text-[#fb923c]',
  project: 'bg-[rgba(59,130,246,0.12)] text-[#2563eb] dark:bg-[rgba(59,130,246,0.2)] dark:text-[#60a5fa]',
  recurrence: 'bg-[rgba(168,85,247,0.12)] text-[#9333ea] dark:bg-[rgba(168,85,247,0.2)] dark:text-[#c084fc]',
}

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
  return (
    <span
      data-chip-type={type}
      data-chip-source={source}
      style={type === 'priority' ? priorityStyle(priority) : undefined}
      className={`group inline-flex items-center gap-0.5 rounded-chip px-2 py-0.5 text-[11px] font-medium leading-snug ${chipStyles[type] ?? ''}`}
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
