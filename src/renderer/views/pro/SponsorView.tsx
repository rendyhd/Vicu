import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Printer } from 'lucide-react'
import { usePortfolio } from '@/hooks/use-portfolio'
import { usePro } from '@/hooks/use-pro'
import { usePersonLabels } from '@/hooks/use-people'
import { api } from '@/lib/api'
import { toast } from '@/stores/toast-store'
import { ReadingScroll } from '@/components/layout/ReadingScroll'
import { PageHeader } from '@/components/shared/PageHeader'
import { ProOffNotice } from '@/components/pro/ProOffNotice'
import { diffLocalDays, toLocalDate } from '../../../shared/due-dates'
import { recordValue, type EscalationValue, type OwedValue } from '../../../shared/pro/ledger'
import { readiness } from '../../../shared/pro/portfolio'
import { buildOnePager } from '../../../shared/pro/one-pager'

const ACTION = 'inline-flex items-center gap-1.5 rounded-control border border-border px-2.5 py-1 text-meta text-text hover:bg-bg-hover'
const SMALL = 'rounded-control border border-border px-2 py-0.5 text-meta text-text hover:bg-bg-hover'

/**
 * The Sponsor desk (plan 7.6.4): escalations to accept and resolve, decisions owed with their age,
 * initiatives without agreed capacity, parked ones, and the one-pager.
 */
export function SponsorView() {
  const { t } = useTranslation()
  const pro = usePro()
  const portfolio = usePortfolio()
  const people = usePersonLabels()
  const [deciding, setDeciding] = useState<{ id: string; text: string } | null>(null)
  const today = toLocalDate(new Date())
  if (!pro.layer('portfolio')) return <ProOffNotice title={t('pro.sponsorView.title')} />

  const ledger = portfolio.ledger
  const personName = (id: number) => people.get(id)?.title ?? t('pro.sponsorView.someone')
  const escalations = Object.keys(ledger.escalations).flatMap((id) => {
    const value = recordValue(ledger.escalations, id) as EscalationValue | null
    return value && (value.status === 'drafted' || value.status === 'accepted') ? [{ id, value }] : []
  })
  const owed = Object.keys(ledger.owed).flatMap((id) => {
    const value = recordValue(ledger.owed, id) as OwedValue | null
    return value && !value.resolved ? [{ id, value }] : []
  })
  const noCapacity = portfolio.ranked.filter((entry) => readiness(entry.value).missing.includes('capacity'))
  const onePager = () => buildOnePager({ ledger, today, projectName: portfolio.titleOf, personName })

  const copy = async () => {
    const page = onePager()
    await api.writeClipboardRich(page.text, page.html)
    toast.success(t('pro.sponsorView.copied'))
  }
  const print = async () => {
    const result = await api.printHtml(onePager().html)
    if (!result.success) toast.error(result.error)
  }

  return (
    <ReadingScroll className="bg-[var(--bg-primary)]" columnClassName="flex flex-col">
      <PageHeader
        title={t('pro.sponsorView.title')}
        inScroll
        actions={
          <div className="flex gap-1.5">
            <button type="button" className={ACTION} onClick={() => void copy()}><Copy className="h-3.5 w-3.5" aria-hidden /> {t('pro.sponsorView.copyOnePager')}</button>
            <button type="button" className={ACTION} onClick={() => void print()}><Printer className="h-3.5 w-3.5" aria-hidden /> {t('pro.sponsorView.print')}</button>
          </div>
        }
      />
      <div className="mx-auto w-full max-w-reading space-y-8 px-6 pb-10">
        <section data-pro-escalations>
          <h2 className="mb-2 text-section text-text">{t('pro.sponsorView.escalations')}</h2>
          {escalations.length === 0 && <p className="text-meta text-text-secondary">{t('pro.sponsorView.noEscalations')}</p>}
          <ul className="space-y-3">
            {escalations.map(({ id, value }) => (
              <li key={id} className="rounded-card border border-border p-3">
                <p className="text-task-title text-text">{value.draft}</p>
                <p className="mt-1 text-meta text-text-secondary">{value.status === 'drafted' ? t('pro.sponsorView.draftSince', { date: value.opened }) : t('pro.sponsorView.agendaSince', { date: value.opened })}</p>
                {deciding?.id === id ? (
                  <form
                    className="mt-2 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void portfolio.setRecordValue('escalations', id, { ...value, status: 'resolved', decision: deciding.text.trim() || null, resolved: today }, t('pro.sponsorView.resolvedMessage'))
                      if (deciding.text.trim()) void portfolio.addLog({ kind: 'decision', text: deciding.text.trim(), initiative: null })
                      setDeciding(null)
                    }}
                  >
                    <input autoFocus value={deciding.text} onChange={(event) => setDeciding({ id, text: event.target.value })} placeholder={t('pro.sponsorView.decisionPlaceholder')} aria-label={t('pro.sponsorView.decision')} className="min-w-0 flex-1 rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text" />
                    <button type="submit" className={SMALL}>{t('pro.common.save')}</button>
                  </form>
                ) : (
                  <div className="mt-2 flex gap-1.5">
                    {value.status === 'drafted' && (
                      <button type="button" className={SMALL} onClick={() => void portfolio.setRecordValue('escalations', id, { ...value, status: 'accepted' }, t('pro.sponsorView.onAgendaMessage'))}>{t('pro.sponsorView.putOnAgenda')}</button>
                    )}
                    <button type="button" className={SMALL} onClick={() => void api.writeClipboardRich(value.draft).then(() => toast.success(t('pro.sponsorView.copiedShort')))}>{t('pro.sponsorView.copy')}</button>
                    <button type="button" className={SMALL} onClick={() => setDeciding({ id, text: '' })}>{t('pro.sponsorView.resolved')}</button>
                    <button type="button" className={SMALL} onClick={() => void portfolio.setRecordValue('escalations', id, { ...value, status: 'dismissed', resolved: today }, t('pro.sponsorView.dismissedMessage'))}>{t('pro.sponsorView.dismiss')}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section data-pro-owed>
          <h2 className="mb-2 text-section text-text">{t('pro.sponsorView.decisionsNeeded')}</h2>
          {owed.length === 0 && <p className="text-meta text-text-secondary">{t('pro.sponsorView.noneOpen')}</p>}
          <ul className="divide-y divide-border">
            {owed.map(({ id, value }) => (
              <li key={id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 text-task-title text-text">{value.what}</span>
                <span className="text-meta text-text-secondary">{t('pro.sponsorView.owedAge', { name: typeof value.from === 'number' ? personName(value.from) : t('pro.sponsorView.nobodyNamed'), count: diffLocalDays(value.opened, today) })}</span>
                <button type="button" className={SMALL} onClick={() => void portfolio.setRecordValue('owed', id, { ...value, resolved: today }, t('pro.sponsorView.decidedMessage'))}>{t('pro.sponsorView.decidedMessage')}</button>
              </li>
            ))}
          </ul>
        </section>

        {noCapacity.length > 0 && (
          <section>
            <h2 className="mb-2 text-section text-text">{t('pro.sponsorView.capacityNotAgreed')}</h2>
            <ul className="space-y-1 text-task-title text-text">
              {noCapacity.map((entry) => <li key={entry.projectId}>{entry.rank}. {portfolio.titleOf(entry.projectId)}</li>)}
            </ul>
          </section>
        )}
      </div>
    </ReadingScroll>
  )
}
