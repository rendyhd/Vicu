import { parse, type ParserConfig } from '../task-parser'
import { toLocalDate } from '../../../shared/due-dates'
import { instantOfLocal } from '../../../shared/ai/dictation'

/**
 * The quick-add parser as dictation reads `when.said` (docs/ai-assistant-v1.md section 4.3, step
 * 4): only dates enabled, every other token type suppressed, no `!` shortcut, whatever the user's
 * parser settings, at the dictation's reference time. `locale` decides slash dates.
 */
export function datesOnlyParserConfig(locale?: string): ParserConfig {
  return {
    enabled: true,
    syntaxMode: 'todoist',
    suppressTypes: ['place', 'label', 'project', 'priority', 'duration', 'recurrence'],
    bangToday: false,
    ...(locale ? { locale } : {}),
  }
}

/** The local date and, when the words named one, the time `HH:MM` the parser reads; null for none. */
export function readSaid(said: string, reference: string, locale?: string): { date: string; time: string | null } | null {
  const result = parse(said, datesOnlyParserConfig(locale), instantOfLocal(reference))
  if (!result.dueDate) return null
  const due = result.dueDate
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: toLocalDate(due),
    time: result.dueHasTime ? `${pad(due.getHours())}:${pad(due.getMinutes())}` : null,
  }
}
