import type { ParseResult, TokenType } from '@/lib/task-parser'

// Match Quick Entry colors: green=date, red=priority, orange=label, blue=project, purple=recurrence
const chipStyles: Record<string, string> = {
  date: 'bg-[rgba(34,197,94,0.12)] text-[#16a34a] dark:bg-[rgba(34,197,94,0.2)] dark:text-[#4ade80]',
  priority: 'bg-[rgba(239,68,68,0.12)] text-[#dc2626] dark:bg-[rgba(239,68,68,0.2)] dark:text-[#f87171]',
  label: 'bg-[rgba(249,115,22,0.12)] text-[#ea580c] dark:bg-[rgba(249,115,22,0.2)] dark:text-[#fb923c]',
  project: 'bg-[rgba(59,130,246,0.12)] text-[#2563eb] dark:bg-[rgba(59,130,246,0.2)] dark:text-[#60a5fa]',
  recurrence: 'bg-[rgba(168,85,247,0.12)] text-[#9333ea] dark:bg-[rgba(168,85,247,0.2)] dark:text-[#c084fc]',
}

const priorityLabels = ['', 'Low', 'Medium', 'High', 'Urgent']

function formatDateLabel(date: Date): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  if (diffDays > 1 && diffDays <= 7) {
    return target.toLocaleDateString(undefined, { weekday: 'long' })
  }
  return target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export interface ChipData {
  type: TokenType
  label: string
  key: string
}

/** Convert a ParseResult into a flat array of chip descriptors. */
export function buildChips(result: ParseResult): ChipData[] {
  const chips: ChipData[] = []

  if (result.dueDate) {
    chips.push({ type: 'date', label: formatDateLabel(result.dueDate), key: 'date' })
  }
  if (result.priority !== null && result.priority > 0) {
    chips.push({
      type: 'priority',
      label: priorityLabels[result.priority] || `P${result.priority}`,
      key: 'priority',
    })
  }
  for (const lbl of result.labels) {
    chips.push({ type: 'label', label: lbl, key: `label-${lbl}` })
  }
  if (result.project) {
    chips.push({ type: 'project', label: result.project, key: 'project' })
  }
  if (result.recurrence) {
    const { interval, unit } = result.recurrence
    const label = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`
    chips.push({ type: 'recurrence', label, key: 'recurrence' })
  }

  return chips
}

interface TokenChipProps {
  type: TokenType
  label: string
  onDismiss?: () => void
}

export function TokenChip({ type, label, onDismiss }: TokenChipProps) {
  return (
    <span
      className={`group inline-flex items-center gap-0.5 rounded-[10px] px-2 py-0.5 text-[11px] font-medium leading-snug ${chipStyles[type] ?? ''}`}
    >
      {label}
      {onDismiss && (
        <button
          type="button"
          className="ml-0.5 opacity-0 transition-opacity group-hover:opacity-100"
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
