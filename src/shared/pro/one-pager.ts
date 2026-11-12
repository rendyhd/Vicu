/**
 * The one-pager (plan 7.6.5): the portfolio on one printed page for a sponsor. Pure: names and the
 * date words are passed in. Only imports its siblings, so every tsconfig can include it.
 */
import { addLocalDays, type LocalDate } from '../due-dates'
import { recordValue, type EscalationValue, type LogValue, type OwedValue, type ProLedger } from './ledger'
import { capState, rankedInitiatives, readiness } from './portfolio'

export interface OnePagerInput {
  ledger: ProLedger
  today: LocalDate
  title?: string
  projectName: (projectId: number) => string
  personName: (personId: number) => string
  /** The last days of decisions to list. */
  days?: number
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface OnePager {
  text: string
  html: string
}

export function buildOnePager(input: OnePagerInput): OnePager {
  const { ledger, today } = input
  const title = input.title ?? 'Portfolio'
  const cap = capState(ledger)
  const since = addLocalDays(today, -(input.days ?? 14))
  const name = (id: number | null | undefined) => (typeof id === 'number' ? input.personName(id) : 'nobody yet')
  const sections: Array<{ heading: string; lines: string[] }> = []

  sections.push({
    heading: `Active (${cap.active} of ${cap.cap}${cap.agreed ? ', agreed' : ', cap not agreed'})`,
    lines: rankedInitiatives(ledger).map((entry) => {
      const ready = readiness(entry.value)
      return `${entry.rank}. ${input.projectName(entry.projectId)}: owner ${name(entry.value.owner)}, sponsor ${name(entry.value.sponsor)}, ready ${ready.done} of ${ready.total}`
    }),
  })

  const parked = Object.keys(ledger.initiatives).flatMap((id) => {
    const value = recordValue(ledger.initiatives, id)
    return value?.status === 'parked' ? [`${input.projectName(Number(id))}${value.parked?.reason ? `: ${value.parked.reason}` : ''}`] : []
  })
  if (parked.length) sections.push({ heading: 'Parked', lines: parked })

  const escalations = Object.values(ledger.escalations).flatMap((record) => {
    const value = record.value as EscalationValue | null
    return value && (value.status === 'accepted' || value.status === 'drafted') ? [value.draft] : []
  })
  if (escalations.length) sections.push({ heading: 'To decide together', lines: escalations })

  const owed = Object.values(ledger.owed).flatMap((record) => {
    const value = record.value as OwedValue | null
    return value && !value.resolved ? [`${value.what} (from ${name(value.from)}, open since ${value.opened})`] : []
  })
  if (owed.length) sections.push({ heading: 'Decisions needed', lines: owed })

  const decided = Object.values(ledger.log).flatMap((record) => {
    const value = record.value as LogValue | null
    return value && value.kind !== 'unknown' && value.at >= since ? [{ at: value.at, line: `${value.at} ${value.kind === 'value' ? 'Value' : 'Decided'}: ${value.text}` }] : []
  })
  decided.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  if (decided.length) sections.push({ heading: 'Recent decisions and results', lines: decided.map((entry) => entry.line) })

  const text = [`${title}, ${today}`, ...sections.flatMap((section) => ['', section.heading, ...section.lines.map((line) => `- ${line}`)])].join('\n')
  const html = [
    '<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title>',
    '<style>body{font-family:system-ui,sans-serif;font-size:12pt;margin:24pt;color:#111}h1{font-size:16pt;margin:0 0 12pt}h2{font-size:12pt;margin:14pt 0 4pt}ul{margin:0;padding-left:16pt}li{margin:2pt 0}</style>',
    '</head><body>',
    `<h1>${escapeHtml(title)}, ${escapeHtml(today)}</h1>`,
    ...sections.map((section) => `<h2>${escapeHtml(section.heading)}</h2><ul>${section.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`),
    '</body></html>',
  ].join('')
  return { text, html }
}
