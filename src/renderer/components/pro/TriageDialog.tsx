import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '@/components/overlay/Dialog'
import { usePortfolio } from '@/hooks/use-portfolio'
import { usePersonLabels } from '@/hooks/use-people'
import { useAddLabel, useCompleteTask, useUpdateTask } from '@/hooks/use-task-mutations'
import { api } from '@/lib/api'
import { toast } from '@/stores/toast-store'
import type { Task } from '@/lib/vikunja-types'
import { toLocalDate } from '../../../shared/due-dates'
import { confirmTitle } from '../../../shared/pro/promises'
import { readiness } from '../../../shared/pro/portfolio'
import { ledgerSettings } from '../../../shared/pro/ledger'
import { newLedgerId } from '@/hooks/use-pro-ledger'

type Choice = 'accept' | 'delegate' | 'decline' | 'ask'

const OPTION = 'rounded-chip border px-2.5 py-1 text-meta'

/**
 * Request triage (cross-app semantics 21.10, plan 7.6.6): a request next to the ranked portfolio.
 * Accept it into an initiative, delegate it (a confirm task), decline it (logged), or ask the
 * sponsor (a decision owed). A reply to send back is copied.
 */
export function TriageDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const { t } = useTranslation()
  const portfolio = usePortfolio()
  const people = usePersonLabels()
  const update = useUpdateTask()
  const complete = useCompleteTask()
  const addLabel = useAddLabel()
  const [choice, setChoice] = useState<Choice>('accept')
  const [initiative, setInitiative] = useState<number | null>(portfolio.ranked[0]?.projectId ?? null)
  const [person, setPerson] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const settings = ledgerSettings(portfolio.ledger)
  const sponsor = settings.cap_agreed?.by ?? null
  const title = task.title.trim()

  const reply = (): string => {
    switch (choice) {
      case 'accept': {
        const rank = portfolio.ranked.find((entry) => entry.projectId === initiative)?.rank
        return rank
          ? t('pro.triage.replyAcceptRank', { title, initiative: portfolio.titleOf(initiative ?? 0), rank })
          : t('pro.triage.replyAccept', { title, initiative: portfolio.titleOf(initiative ?? 0) })
      }
      case 'delegate':
        return t('pro.triage.replyDelegate', { name: people.get(person ?? 0)?.title ?? t('pro.triage.colleague'), title })
      case 'decline':
        return reason.trim()
          ? t('pro.triage.replyDeclineReason', { title, reason: reason.trim(), count: portfolio.ranked.length })
          : t('pro.triage.replyDecline', { title, count: portfolio.ranked.length })
      case 'ask':
        return t('pro.triage.replyAsk', { title, name: sponsor !== null ? people.get(sponsor)?.title ?? t('pro.triage.ourSponsor') : t('pro.triage.ourSponsor') })
    }
  }

  const apply = async () => {
    const today = toLocalDate(new Date())
    if (choice === 'accept' && initiative !== null) {
      update.mutate({ id: task.id, changes: { project_id: initiative }, original: task })
    } else if (choice === 'delegate' && person !== null) {
      const name = people.get(person)?.title ?? 'them'
      update.mutate({ id: task.id, changes: { title: confirmTitle(name, title) }, original: task })
      if (!(task.labels ?? []).some((label) => label.id === person)) addLabel.mutate({ taskId: task.id, labelId: person })
    } else if (choice === 'decline') {
      await portfolio.addLog({ kind: 'decision', text: `Declined "${title}"${reason.trim() ? `: ${reason.trim()}` : ''}`, initiative: null })
      complete.mutate(task)
    } else if (choice === 'ask') {
      await portfolio.setRecordValue('owed', newLedgerId(), { what: title, from: sponsor, initiative: null, opened: today }, t('pro.triage.askedSponsor'))
    }
    await api.writeClipboardRich(reply())
    toast.success(t('pro.triage.copied'))
    onClose()
  }

  const ready = choice !== 'accept' || initiative !== null
  const canApply = ready && (choice !== 'delegate' || person !== null)

  return (
    <Dialog open label={t('pro.triage.label')} onClose={onClose} className="w-[600px] max-w-[92vw] p-5">
      <h2 className="mb-1 text-card-title text-text">{t('pro.triage.title', { title })}</h2>
      <p className="mb-3 text-meta text-text-secondary">{portfolio.cap.unlimited ? t('pro.groundwork.triageNoLimit', { count: portfolio.cap.active }) : t('pro.triage.capped', { active: portfolio.cap.active, cap: portfolio.cap.cap })}</p>
      <ol className="mb-4 divide-y divide-border rounded-card border border-border">
        {portfolio.ranked.map((entry) => (
          <li key={entry.projectId} className="flex items-center gap-3 px-3 py-1.5 text-meta text-text">
            <span className="w-5 text-right text-text-secondary">{entry.rank}</span>
            <span className="min-w-0 flex-1 truncate">{portfolio.titleOf(entry.projectId)}</span>
            <span className="text-text-secondary">{t('pro.triage.ready', { done: readiness(entry.value).done })}</span>
          </li>
        ))}
        {portfolio.ranked.length === 0 && <li className="px-3 py-2 text-meta text-text-secondary">{t('pro.triage.none')}</li>}
      </ol>
      <div className="mb-3 flex flex-wrap gap-1" role="radiogroup" aria-label={t('pro.triage.whatToDo')}>
        {(['accept', 'delegate', 'decline', 'ask'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={choice === value}
            onClick={() => setChoice(value)}
            className={choice === value ? `${OPTION} border-accent-blue bg-accent-blue/12 text-accent-blue` : `${OPTION} border-border text-text-secondary hover:bg-bg-hover`}
          >
            {value === 'accept' ? t('pro.triage.accept') : value === 'delegate' ? t('pro.triage.delegate') : value === 'decline' ? t('pro.triage.decline') : t('pro.triage.ask')}
          </button>
        ))}
      </div>
      {choice === 'accept' && (
        <select value={initiative ?? ''} onChange={(event) => setInitiative(event.target.value ? Number(event.target.value) : null)} aria-label={t('pro.triage.initiative')} className="w-full rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text">
          <option value="">{t('pro.triage.chooseInitiative')}</option>
          {portfolio.ranked.map((entry) => <option key={entry.projectId} value={entry.projectId}>{entry.rank}. {portfolio.titleOf(entry.projectId)}</option>)}
        </select>
      )}
      {choice === 'delegate' && (
        <select value={person ?? ''} onChange={(event) => setPerson(event.target.value ? Number(event.target.value) : null)} aria-label={t('pro.triage.person')} className="w-full rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text">
          <option value="">{t('pro.triage.toWhom')}</option>
          {[...people.values()].map((label) => <option key={label.id} value={label.id}>{label.title}</option>)}
        </select>
      )}
      {choice === 'decline' && (
        <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('pro.triage.whyPlaceholder')} aria-label={t('pro.triage.reason')} className="w-full rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text" />
      )}
      <p className="mt-3 rounded-control bg-bg-hover p-2 text-meta text-text" data-pro-triage-reply>{reply()}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="rounded-control px-3 py-1.5 text-meta text-text hover:bg-bg-hover" onClick={onClose}>{t('pro.common.cancel')}</button>
        <button type="button" disabled={!canApply} className="rounded-control bg-accent-fill px-3 py-1.5 text-meta font-medium text-on-accent disabled:opacity-40" onClick={() => void apply()}>{t('pro.triage.apply')}</button>
      </div>
    </Dialog>
  )
}
