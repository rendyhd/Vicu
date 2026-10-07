export type SyntaxMode = 'todoist' | 'vikunja'

export type TokenType = 'label' | 'project' | 'priority' | 'recurrence' | 'date'

export interface ParsedToken {
  type: TokenType
  start: number
  end: number
  value: unknown
  raw: string
}

export interface ParsedRecurrence {
  interval: number
  unit: 'day' | 'week' | 'month' | 'year'
}

export interface ParseResult {
  title: string
  dueDate: Date | null
  /**
   * True when the parsed text named a time of day ("3pm", "14:30", "in 2 hours"), i.e. chrono's
   * `start.isCertain('hour')`. The time of `dueDate` is only meaningful when this is true;
   * otherwise the due date is date-only (build it with `parsedDue`).
   */
  dueHasTime: boolean
  priority: number | null
  labels: string[]
  project: string | null
  recurrence: ParsedRecurrence | null
  tokens: ParsedToken[]
}

export interface SyntaxPrefixes {
  label: string
  project: string
}

export interface ParserConfig {
  enabled: boolean
  syntaxMode: SyntaxMode
  suppressTypes?: TokenType[]
  bangToday?: boolean
  /**
   * BCP 47 locale deciding the order of slash dates ("5/11": month/day in en-US, day/month in
   * en-GB). Defaults to the system locale (`navigator.language`).
   */
  locale?: string
}

const SYNTAX_PREFIXES: Record<SyntaxMode, SyntaxPrefixes> = {
  todoist: { label: '@', project: '#' },
  vikunja: { label: '*', project: '+' },
}

export function getPrefixes(mode: SyntaxMode): SyntaxPrefixes {
  return SYNTAX_PREFIXES[mode]
}

export const DEFAULT_PARSER_CONFIG: ParserConfig = {
  enabled: true,
  syntaxMode: 'todoist',
}
