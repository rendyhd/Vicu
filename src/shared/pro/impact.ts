/**
 * The quarterly impact summary (plan 7.7.6): the value delivered, the decisions, the initiatives
 * closed and the promises settled in a quarter, plus a line the person writes about their own
 * growth. Pure: names are passed in. Only imports its siblings, so every tsconfig can include it.
 */
import { localDateOf, type LocalDate } from '../due-dates'
import { finalVerdictOf, recordValue, type LogValue, type ProLedger } from './ledger'

export interface Quarter {
  /** "Q4 2026". */
  name: string
  from: LocalDate
  to: LocalDate
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The quarter a day is in; `back` quarters earlier with a positive number. */
export function quarterOf(day: LocalDate, back = 0): Quarter {
  const [year, month] = day.split('-').map(Number)
  let index = Math.floor((month - 1) / 3) - back
  let y = year
  while (index < 0) {
    index += 4
    y -= 1
  }
  const firstMonth = index * 3 + 1
  const lastMonth = firstMonth + 2
  const lastDay = new Date(y, lastMonth, 0).getDate()
  return { name: `Q${index + 1} ${y}`, from: `${y}-${pad(firstMonth)}-01`, to: `${y}-${pad(lastMonth)}-${pad(lastDay)}` }
}

export interface ImpactInput {
  ledger: ProLedger
  quarter: Quarter
  projectName: (projectId: number) => string
  personName: (personId: number) => string
  /** What the person writes about their own growth this quarter; empty leaves the section out. */
  growth?: string
}

export interface ImpactSummary {
  sections: Array<{ heading: string; lines: string[] }>
  text: string
  html: string
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function buildImpact(input: ImpactInput): ImpactSummary {
  const { ledger, quarter } = input
  const inQuarter = (day: string | null | undefined) => !!day && day >= quarter.from && day <= quarter.to
  const logOf = (kind: string) =>
    Object.values(ledger.log)
      .map((record) => record.value as LogValue | null)
      .filter((value): value is LogValue => !!value && value.kind === kind && inQuarter(value.at))
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  const initiativeOf = (value: LogValue) => (typeof value.initiative === 'number' ? ` (${input.projectName(value.initiative)})` : '')
  const sections: ImpactSummary['sections'] = []

  const value = logOf('value').map((entry) => `${entry.text}${initiativeOf(entry)}`)
  if (value.length) sections.push({ heading: 'Value delivered', lines: value })

  const closed = Object.keys(ledger.initiatives).flatMap((id) => {
    const initiative = recordValue(ledger.initiatives, id)
    return initiative?.status === 'closed' && inQuarter(initiative.closed_on) ? [`${input.projectName(Number(id))}, closed ${initiative.closed_on}`] : []
  })
  if (closed.length) sections.push({ heading: 'Initiatives closed', lines: closed })

  const decisions = logOf('decision').map((entry) => `${entry.at} ${entry.text}${initiativeOf(entry)}`)
  if (decisions.length) sections.push({ heading: 'Decisions', lines: decisions })

  const counts = new Map<string, number>()
  for (const record of Object.values(ledger.promises)) {
    const final = finalVerdictOf(record.value)
    if (!final || !inQuarter(localDateOf(final.at))) continue
    const key = `${record.value?.dir === 'mine' ? 'mine' : 'theirs'}:${final.kind}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const count = (dir: string, kind: string) => counts.get(`${dir}:${kind}`) ?? 0
  const promiseLines: string[] = []
  const mineKept = count('mine', 'delivered') + count('mine', 'late')
  const theirsKept = count('theirs', 'delivered') + count('theirs', 'late')
  if (mineKept || count('mine', 'dropped')) promiseLines.push(`You kept ${mineKept} ${mineKept === 1 ? 'promise' : 'promises'} (${count('mine', 'late')} late), dropped ${count('mine', 'dropped')}.`)
  if (theirsKept || count('theirs', 'dropped') || count('theirs', 'taken_over')) {
    promiseLines.push(`Others kept ${theirsKept} (${count('theirs', 'late')} late); ${count('theirs', 'taken_over')} you took over, ${count('theirs', 'dropped')} dropped.`)
  }
  if (promiseLines.length) sections.push({ heading: 'Promises', lines: promiseLines })

  const growth = input.growth?.trim()
  if (growth) sections.push({ heading: 'Growth', lines: [growth] })

  const title = `Impact, ${quarter.name}`
  const text = [title, ...(sections.length ? sections.flatMap((section) => ['', section.heading, ...section.lines.map((line) => `- ${line}`)]) : ['', 'Nothing recorded this quarter.'])].join('\n')
  const html = [
    '<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title>',
    '<style>body{font-family:system-ui,sans-serif;font-size:12pt;margin:24pt;color:#111}h1{font-size:16pt;margin:0 0 12pt}h2{font-size:12pt;margin:14pt 0 4pt}ul{margin:0;padding-left:16pt}li{margin:2pt 0}</style>',
    '</head><body>',
    `<h1>${escapeHtml(title)}</h1>`,
    ...(sections.length
      ? sections.map((section) => `<h2>${escapeHtml(section.heading)}</h2><ul>${section.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`)
      : ['<p>Nothing recorded this quarter.</p>']),
    '</body></html>',
  ].join('')
  return { sections, text, html }
}
