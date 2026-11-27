import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePortfolio } from '@/hooks/use-portfolio'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { Dialog } from '@/components/overlay/Dialog'
import { usePersonLabels } from '@/hooks/use-people'
import { newLedgerId, setRecord, writeLedger } from '@/hooks/use-pro-ledger'
import type { MeetingValue } from '../../../shared/pro/ledger'
import type { TranslationKey } from '../../../shared/i18n'

// The stored value is the English phrase (the ledger keeps it); its label is translated where it is shown.
const RHYTHMS: ReadonlyArray<{ value: string; label: TranslationKey }> = [
  { value: '', label: 'pro.meeting.rhythm.none' },
  { value: 'weekly', label: 'pro.meeting.rhythm.weekly' },
  { value: 'every two weeks', label: 'pro.meeting.rhythm.everyTwoWeeks' },
  { value: 'monthly', label: 'pro.meeting.rhythm.monthly' },
]

/**
 * A meeting (cross-app semantics 21.9, plan 7.5.1): a name, its people in the order the round goes,
 * and how often it meets. Kept in the ledger, so every device knows it.
 */
export function MeetingDialog({ meeting, id, onClose }: { meeting?: MeetingValue | null; id?: string; onClose: () => void }) {
  const { t } = useTranslation()
  const portfolio = usePortfolio()
  const queryClient = useQueryClient()
  const people = usePersonLabels()
  const [name, setName] = useState(meeting?.name ?? '')
  const [order, setOrder] = useState<number[]>(meeting?.people ?? [])
  const [rhythm, setRhythm] = useState(meeting?.rhythm ?? '')
  const [initiatives, setInitiatives] = useState<number[]>(meeting?.initiatives ?? [])
  const others = [...people.values()].filter((label) => !order.includes(label.id))

  const move = (index: number, by: number) => {
    const next = [...order]
    const [entry] = next.splice(index, 1)
    next.splice(Math.max(0, Math.min(next.length, index + by)), 0, entry)
    setOrder(next)
  }
  const save = () => {
    const value: MeetingValue = { ...(meeting ?? {}), name: name.trim(), people: order, rhythm: rhythm || null }
    if (initiatives.length) value.initiatives = initiatives
    else delete value.initiatives
    void writeLedger(queryClient, [setRecord('meetings', id ?? newLedgerId(), value)])
    onClose()
  }

  return (
    <Dialog open label={t('pro.meeting.label')} onClose={onClose} className="w-[440px] max-w-[92vw] p-5">
      <h2 className="mb-3 text-card-title text-text">{meeting ? t('pro.meeting.edit') : t('pro.meeting.new')}</h2>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('pro.meeting.name')} aria-label={t('pro.meeting.name')} autoFocus className="mb-3 w-full rounded-control border border-border bg-bg-page px-2 py-1.5 text-task-title text-text" />
      <p className="mb-1 text-group text-text-secondary">{t('pro.meeting.people')}</p>
      <ul className="mb-2 space-y-1">
        {order.map((personId, index) => (
          <li key={personId} className="flex items-center gap-2 rounded-control border border-border px-2 py-1 text-meta text-text">
            <span className="min-w-0 flex-1 truncate">{people.get(personId)?.title ?? t('pro.meeting.someone')}</span>
            <button type="button" aria-label={t('pro.meeting.earlier')} disabled={index === 0} onClick={() => move(index, -1)} className="rounded-control p-0.5 hover:bg-bg-hover disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
            <button type="button" aria-label={t('pro.meeting.later')} disabled={index === order.length - 1} onClick={() => move(index, 1)} className="rounded-control p-0.5 hover:bg-bg-hover disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
            <button type="button" aria-label={t('pro.meeting.remove')} onClick={() => setOrder(order.filter((entry) => entry !== personId))} className="rounded-control p-0.5 hover:bg-bg-hover"><X className="h-3 w-3" /></button>
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <select value="" onChange={(event) => event.target.value && setOrder([...order, Number(event.target.value)])} aria-label={t('pro.meeting.addPerson')} className="mb-3 w-full rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text">
          <option value="">{t('pro.meeting.addPerson')}</option>
          {others.map((label) => <option key={label.id} value={label.id}>{label.title}</option>)}
        </select>
      )}
      {portfolio.ranked.length > 0 && (
        <fieldset className="mb-3">
          <legend className="mb-1 text-group text-text-secondary">{t('pro.groundwork.meetingInitiatives')}</legend>
          <ul className="space-y-1">
            {portfolio.ranked.map((entry) => (
              <li key={entry.projectId}>
                <label className="flex items-center gap-2 text-meta text-text">
                  <input
                    type="checkbox"
                    checked={initiatives.includes(entry.projectId)}
                    onChange={(event) => setInitiatives(event.target.checked ? [...initiatives, entry.projectId] : initiatives.filter((id) => id !== entry.projectId))}
                  />
                  <span className="min-w-0 truncate">{portfolio.titleOf(entry.projectId)}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <label className="flex items-center gap-2 text-meta text-text">
        {t('pro.meeting.meets')}
        <select value={rhythm ?? ''} onChange={(event) => setRhythm(event.target.value)} className="rounded-control border border-border bg-bg-page px-2 py-1">
          {RHYTHMS.map((rhythmOption) => <option key={rhythmOption.value} value={rhythmOption.value}>{t(rhythmOption.label)}</option>)}
        </select>
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="rounded-control px-3 py-1.5 text-meta text-text hover:bg-bg-hover" onClick={onClose}>{t('pro.common.cancel')}</button>
        <button type="button" disabled={!name.trim() || order.length === 0} className="rounded-control bg-accent-fill px-3 py-1.5 text-meta font-medium text-on-accent disabled:opacity-40" onClick={save}>{t('pro.common.save')}</button>
      </div>
    </Dialog>
  )
}
