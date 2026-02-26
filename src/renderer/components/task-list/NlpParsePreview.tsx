import type { ParseResult, ParsedToken } from '@/lib/task-parser'

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

const priorityLabels = ['', 'Low', 'Medium', 'High', 'Urgent']

// Match Quick Entry colors: green=date, red=priority, orange=label, blue=project, purple=recurrence
const chipStyles = {
  date: 'bg-[rgba(34,197,94,0.12)] text-[#16a34a] dark:bg-[rgba(34,197,94,0.2)] dark:text-[#4ade80]',
  priority: 'bg-[rgba(239,68,68,0.12)] text-[#dc2626] dark:bg-[rgba(239,68,68,0.2)] dark:text-[#f87171]',
  label: 'bg-[rgba(249,115,22,0.12)] text-[#ea580c] dark:bg-[rgba(249,115,22,0.2)] dark:text-[#fb923c]',
  project: 'bg-[rgba(59,130,246,0.12)] text-[#2563eb] dark:bg-[rgba(59,130,246,0.2)] dark:text-[#60a5fa]',
  recurrence: 'bg-[rgba(168,85,247,0.12)] text-[#9333ea] dark:bg-[rgba(168,85,247,0.2)] dark:text-[#c084fc]',
} as const

const tokenBgColors: Record<string, string> = {
  date: 'rgba(34, 197, 94, 0.15)',
  priority: 'rgba(239, 68, 68, 0.15)',
  label: 'rgba(249, 115, 22, 0.15)',
  project: 'rgba(59, 130, 246, 0.15)',
  recurrence: 'rgba(168, 85, 247, 0.15)',
}

const tokenBgColorsDark: Record<string, string> = {
  date: 'rgba(34, 197, 94, 0.25)',
  priority: 'rgba(239, 68, 68, 0.25)',
  label: 'rgba(249, 115, 22, 0.25)',
  project: 'rgba(59, 130, 246, 0.25)',
  recurrence: 'rgba(168, 85, 247, 0.25)',
}

interface NlpParsePreviewProps {
  result: ParseResult
}

export function NlpParsePreview({ result }: NlpParsePreviewProps) {
  const chips: Array<{ key: string; label: string; className: string }> = []

  if (result.dueDate) {
    chips.push({
      key: 'date',
      label: formatDateLabel(result.dueDate),
      className: chipStyles.date,
    })
  }

  if (result.priority !== null && result.priority > 0) {
    chips.push({
      key: 'priority',
      label: priorityLabels[result.priority] || `P${result.priority}`,
      className: chipStyles.priority,
    })
  }

  for (const lbl of result.labels) {
    chips.push({
      key: `label-${lbl}`,
      label: lbl,
      className: chipStyles.label,
    })
  }

  if (result.project) {
    chips.push({
      key: 'project',
      label: result.project,
      className: chipStyles.project,
    })
  }

  if (result.recurrence) {
    const { interval, unit } = result.recurrence
    const label = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`
    chips.push({
      key: 'recurrence',
      label,
      className: chipStyles.recurrence,
    })
  }

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 px-4 pb-1.5 pl-[46px]">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className={`inline-flex items-center rounded-[10px] px-2 py-0.5 text-[11px] font-medium leading-snug ${chip.className}`}
        >
          {chip.label}
        </span>
      ))}
    </div>
  )
}

// --- Input Highlight Overlay ---

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/ /g, '\u00a0')
}

interface NlpInputHighlightProps {
  value: string
  tokens: ParsedToken[]
}

export function NlpInputHighlight({ value, tokens }: NlpInputHighlightProps) {
  if (!tokens.length) return null

  const isDark = document.documentElement.classList.contains('dark')
  const colors = isDark ? tokenBgColorsDark : tokenBgColors
  const sorted = [...tokens].sort((a, b) => a.start - b.start)
  const parts: Array<{ text: string; bg?: string }> = []
  let pos = 0

  for (const token of sorted) {
    if (token.start > pos) {
      parts.push({ text: value.slice(pos, token.start) })
    }
    parts.push({
      text: value.slice(token.start, token.end),
      bg: colors[token.type],
    })
    pos = token.end
  }
  if (pos < value.length) {
    parts.push({ text: value.slice(pos) })
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-[13px] text-transparent"
      aria-hidden
    >
      {parts.map((part, i) =>
        part.bg ? (
          <span key={i} style={{ background: part.bg, borderRadius: 3 }}>
            {escapeHtml(part.text)}
          </span>
        ) : (
          <span key={i}>{escapeHtml(part.text)}</span>
        )
      )}
    </div>
  )
}
