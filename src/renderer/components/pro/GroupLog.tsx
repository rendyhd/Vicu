import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, ListPlus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/shared/Button'
import { toast } from '@/stores/toast-store'
import { currentLedger, newLedgerId, restoreRecords, setRecord, writeLedger } from '@/hooks/use-pro-ledger'
import { toLocalDate } from '../../../shared/due-dates'
import { recordValue, type LogValue } from '../../../shared/pro/ledger'
import { openIssues, type LogEntry } from '../../../shared/pro/groups'

const FIELD = 'min-w-0 flex-1 rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text'
const ICON = 'rounded-control p-1 text-text-secondary hover:bg-bg-hover hover:text-text disabled:opacity-30'

export type GroupLogKind = 'issue' | 'blocker' | 'commitment' | 'decision' | 'stop' | 'unknown'

/** A new log entry of a group; captured in a session when one is open. */
export function logEntryFor(kind: GroupLogKind, text: string, group: number, session: string | null): LogValue {
  const value: LogValue = { kind, text: text.trim(), at: toLocalDate(new Date()), group }
  if (session) value.session = session
  return value
}

/**
 * A group's issues, blockers, commitments, decisions, stops and open questions (cross-app semantics
 * 21.16): one kind of record in the log, shown as short lists, each with a field to add one. Issues
 * are ranked and can be solved; a question can be answered; a blocker, commitment or stop stays
 * open until it is closed (with Undo).
 */
const ALL_KINDS: readonly GroupLogKind[] = ['issue', 'blocker', 'commitment', 'decision', 'stop', 'unknown']

export function GroupLog({ label, issues, decisions, questions, blockers = [], commitments = [], stops = [], session = null, nameOf, show = ALL_KINDS, onMakeAction }: {
  label: number
  issues: readonly LogEntry[]
  decisions: readonly LogEntry[]
  questions: readonly LogEntry[]
  blockers?: readonly LogEntry[]
  commitments?: readonly LogEntry[]
  stops?: readonly LogEntry[]
  /** The open session's round id: what is added now is captured in it. */
  session?: string | null
  nameOf: (personId: number | null | undefined) => string
  /** The lists to show; all six without it. */
  show?: readonly GroupLogKind[]
  /** An issue gets a button that makes an action of it (a session). */
  onMakeAction?: (entry: LogEntry) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const add = (kind: GroupLogKind, text: string) => {
    if (!text.trim()) return
    const value = logEntryFor(kind, text, label, session)
    if (kind === 'issue') value.rank = issues.length + 1
    void writeLedger(queryClient, [setRecord('log', newLedgerId(), value)])
  }
  const change = (id: string, patch: Partial<LogValue>) => {
    const before = recordValue(currentLedger(queryClient).log, id)
    if (before) void writeLedger(queryClient, [setRecord('log', id, { ...before, ...patch })])
  }
  /** Moves an issue one place: the open issues are numbered again, one step apart. */
  const move = (id: string, by: number) => {
    const order = openIssues(currentLedger(queryClient), label).map((entry) => entry.id)
    const from = order.indexOf(id)
    const to = from + by
    if (from < 0 || to < 0 || to >= order.length) return
    order.splice(to, 0, order.splice(from, 1)[0])
    const ledger = currentLedger(queryClient)
    const operations = order.flatMap((entryId, index) => {
      const value = recordValue(ledger.log, entryId)
      return value && value.rank !== index + 1 ? [setRecord('log', entryId, { ...value, rank: index + 1 })] : []
    })
    void writeLedger(queryClient, operations)
  }
  /** Closes a blocker, commitment or stop: `resolved` is today, and Undo puts the record back as it was. */
  const close = (entry: LogEntry) => {
    const before = currentLedger(queryClient)
    change(entry.id, { resolved: today, ...(session ? { solved_in: session } : {}) })
    toast.success(t('pro.groupLog.closed', { text: entry.value.text }), {
      action: { label: t('pro.groupLog.undo'), onAction: () => void writeLedger(queryClient, restoreRecords(before, [{ collection: 'log', id: entry.id }])) },
    })
  }
  const today = toLocalDate(new Date())
  const closeList = (kind: 'blocker' | 'commitment' | 'stop', entries: readonly LogEntry[]) => {
    const text = {
      blocker: { title: t('pro.groupLog.blockers'), placeholder: t('pro.groupLog.addBlocker'), empty: t('pro.groupLog.noBlockers'), button: t('pro.groupLog.outOfTheWay'), aria: (what: string) => t('pro.groupLog.outOfTheWayAria', { text: what }) },
      commitment: { title: t('pro.groupLog.commitments'), placeholder: t('pro.groupLog.addCommitment'), empty: t('pro.groupLog.noCommitments'), button: t('pro.groupLog.close'), aria: (what: string) => t('pro.groupLog.closeAria', { text: what }) },
      stop: { title: t('pro.groupLog.stops'), placeholder: t('pro.groupLog.addStop'), empty: t('pro.groupLog.noStops'), button: t('pro.groupLog.close'), aria: (what: string) => t('pro.groupLog.closeAria', { text: what }) },
    }[kind]
    return (
      <LogList title={text.title} placeholder={text.placeholder} empty={text.empty} onAdd={(value) => add(kind, value)} kind={kind}>
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-start gap-2 py-1" data-pro-log-entry={entry.id}>
            <span className="min-w-0 flex-1 text-meta text-text">{entry.value.text}<span className="ml-1 text-text-secondary">{entry.value.at}</span></span>
            <button type="button" className="shrink-0 rounded-control border border-border px-2 py-0.5 text-meta text-text hover:bg-bg-hover" aria-label={text.aria(entry.value.text)} onClick={() => close(entry)} data-pro-close={entry.id}>
              {text.button}
            </button>
          </li>
        ))}
      </LogList>
    )
  }

  return (
    <div className={cn('grid gap-4 px-6 pb-6 pt-2', show.length >= 3 && 'md:grid-cols-3', show.length === 2 && 'md:grid-cols-2')} data-pro-group-log>
      {show.includes('issue') && <LogList title={t('pro.group.log.issues')} placeholder={t('pro.group.log.addIssue')} empty={t('pro.group.log.noIssues')} onAdd={(text) => add('issue', text)} kind="issue">
        {issues.map((entry, index) => (
          <li key={entry.id} className="flex items-start gap-1 py-1" data-pro-issue={entry.id}>
            <span className="w-4 shrink-0 text-meta tabular-nums text-text-secondary">{index + 1}</span>
            <span className="min-w-0 flex-1 text-meta text-text">{entry.value.text}</span>
            <button type="button" className={ICON} disabled={index === 0} aria-label={t('pro.group.log.up', { text: entry.value.text })} onClick={() => move(entry.id, -1)}><ArrowUp className="h-3 w-3" aria-hidden /></button>
            <button type="button" className={ICON} disabled={index === issues.length - 1} aria-label={t('pro.group.log.down', { text: entry.value.text })} onClick={() => move(entry.id, 1)}><ArrowDown className="h-3 w-3" aria-hidden /></button>
            {onMakeAction && (
              <button type="button" className={ICON} aria-label={t('pro.group.log.makeAction', { text: entry.value.text })} onClick={() => onMakeAction(entry)}><ListPlus className="h-3 w-3" aria-hidden /></button>
            )}
            <button
              type="button"
              className={ICON}
              aria-label={t('pro.group.log.solve', { text: entry.value.text })}
              onClick={() => change(entry.id, { resolved: today, ...(session ? { solved_in: session } : {}) })}
            >
              <Check className="h-3 w-3" aria-hidden />
            </button>
          </li>
        ))}
      </LogList>}
      {show.includes('blocker') && closeList('blocker', blockers)}
      {show.includes('commitment') && closeList('commitment', commitments)}
      {show.includes('decision') && <LogList title={t('pro.group.log.decisions')} placeholder={t('pro.group.log.addDecision')} empty={t('pro.group.log.noDecisions')} onAdd={(text) => add('decision', text)} kind="decision">
        {decisions.slice(0, 8).map((entry) => (
          <li key={entry.id} className="py-1 text-meta text-text" data-pro-decision={entry.id}>
            {entry.value.text}
            <span className="ml-1 text-text-secondary">
              {typeof entry.value.by === 'number' && entry.value.by > 0
                ? t('pro.group.log.decidedBy', { name: nameOf(entry.value.by), date: entry.value.at })
                : entry.value.at}
              {(entry.value.shared ?? []).length === 0 && <> · {t('pro.group.log.notShared')}</>}
            </span>
          </li>
        ))}
      </LogList>}
      {show.includes('stop') && closeList('stop', stops)}
      {show.includes('unknown') && <LogList title={t('pro.group.log.questions')} placeholder={t('pro.group.log.addQuestion')} empty={t('pro.group.log.noQuestions')} onAdd={(text) => add('unknown', text)} kind="unknown">
        {questions.map((entry) => (
          <li key={entry.id} className="flex items-start gap-1 py-1" data-pro-question={entry.id}>
            <span className="min-w-0 flex-1 text-meta text-text">{entry.value.text}</span>
            <button type="button" className={ICON} aria-label={t('pro.group.log.answered', { text: entry.value.text })} onClick={() => change(entry.id, { resolved: today })}>
              <Check className="h-3 w-3" aria-hidden />
            </button>
          </li>
        ))}
      </LogList>}
    </div>
  )
}

function LogList({ title, placeholder, empty, onAdd, kind, children }: {
  title: string
  placeholder: string
  empty: string
  onAdd: (text: string) => void
  kind: GroupLogKind
  children: React.ReactNode[]
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  return (
    <section className="min-w-0 rounded-card border border-border p-3" aria-label={title} data-pro-log={kind}>
      <h2 className="mb-1 text-group text-text-secondary">{title}</h2>
      {children.length === 0 ? <p className="py-1 text-meta text-text-secondary">{empty}</p> : <ul className="divide-y divide-border">{children}</ul>}
      <form
        className="mt-2 flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          onAdd(text)
          setText('')
        }}
      >
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder={placeholder} aria-label={placeholder} className={FIELD} />
        <Button type="submit" variant="quiet" disabled={!text.trim()}>{t('pro.group.log.add')}</Button>
      </form>
    </section>
  )
}
