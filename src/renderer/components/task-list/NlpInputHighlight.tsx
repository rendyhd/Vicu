import type { ParsedToken } from '@/lib/task-parser'
import { useIsDark } from '@/hooks/use-is-dark'
import { tokenHighlightBackground } from '@/lib/token-chip-colors'

// Token highlight colours: green=date, red=priority, orange=label, blue=project, purple=recurrence,
// as design token roles (lib/token-chip-colors.ts).

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
  multiline?: boolean
}

export function NlpInputHighlight({ value, tokens, multiline = false }: NlpInputHighlightProps) {
  const isDark = useIsDark()
  if (!tokens.length) return null

  const sorted = [...tokens].sort((a, b) => a.start - b.start)
  const parts: Array<{ text: string; bg?: string; type?: string }> = []
  let pos = 0

  for (const token of sorted) {
    if (token.start > pos) {
      parts.push({ text: value.slice(pos, token.start) })
    }
    parts.push({
      text: value.slice(token.start, token.end),
      bg: tokenHighlightBackground(token.type, isDark),
      type: token.type,
    })
    pos = token.end
  }
  if (pos < value.length) {
    parts.push({ text: value.slice(pos) })
  }

  return (
    <div
      className={
        multiline
          ? 'vicu-token-layer pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-[13px] font-medium leading-snug text-transparent'
          : 'vicu-token-layer pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-[13px] text-transparent'
      }
      aria-hidden
    >
      {parts.map((part, i) =>
        part.bg ? (
          <span key={i} data-token-type={part.type} style={{ background: part.bg, borderRadius: 3 }}>
            {escapeHtml(part.text)}
          </span>
        ) : (
          <span key={i}>{escapeHtml(part.text)}</span>
        )
      )}
    </div>
  )
}
