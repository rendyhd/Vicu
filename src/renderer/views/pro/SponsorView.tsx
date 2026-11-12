import { useState } from 'react'
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
  const pro = usePro()
  const portfolio = usePortfolio()
  const people = usePersonLabels()
  const [deciding, setDeciding] = useState<{ id: string; text: string } | null>(null)
  const today = toLocalDate(new Date())
  if (!pro.layer('portfolio')) return <ProOffNotice title="Sponsor desk" />

  const ledger = portfolio.ledger
  const personName = (id: number) => people.get(id)?.title ?? 'someone'
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
    toast.success('One-pager copied')
  }
  const print = async () => {
    const result = await api.printHtml(onePager().html)
    if (!result.success) toast.error(result.error)
  }

  return (
    <ReadingScroll className="bg-[var(--bg-primary)]" columnClassName="flex flex-col">
      <PageHeader
        title="Sponsor desk"
        inScroll
        actions={
          <div className="flex gap-1.5">
            <button type="button" className={ACTION} onClick={() => void copy()}><Copy className="h-3.5 w-3.5" aria-hidden /> Copy one-pager</button>
            <button type="button" className={ACTION} onClick={() => void print()}><Printer className="h-3.5 w-3.5" aria-hidden /> Print</button>
          </div>
        }
      />
      <div className="mx-auto w-full max-w-reading space-y-8 px-6 pb-10">
        <section data-pro-escalations>
          <h2 className="mb-2 text-section text-text">Escalations</h2>
          {escalations.length === 0 && <p className="text-meta text-text-secondary">None. A promise missed twice drafts one here.</p>}
          <ul className="space-y-3">
            {escalations.map(({ id, value }) => (
              <li key={id} className="rounded-card border border-border p-3">
                <p className="text-task-title text-text">{value.draft}</p>
                <p className="mt-1 text-meta text-text-secondary">{value.status === 'drafted' ? 'Draft' : 'On the agenda'}, since {value.opened}</p>
                {deciding?.id === id ? (
                  <form
                    className="mt-2 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void portfolio.setRecordValue('escalations', id, { ...value, status: 'resolved', decision: deciding.text.trim() || null, resolved: today }, 'Escalation resolved')
                      if (deciding.text.trim()) void portfolio.addLog({ kind: 'decision', text: deciding.text.trim(), initiative: null })
                      setDeciding(null)
                    }}
                  >
                    <input autoFocus value={deciding.text} onChange={(event) => setDeciding({ id, text: event.target.value })} placeholder="What was decided" aria-label="Decision" className="min-w-0 flex-1 rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text" />
                    <button type="submit" className={SMALL}>Save</button>
                  </form>
                ) : (
                  <div className="mt-2 flex gap-1.5">
                    {value.status === 'drafted' && (
                      <button type="button" className={SMALL} onClick={() => void portfolio.setRecordValue('escalations', id, { ...value, status: 'accepted' }, 'On the sponsor agenda')}>Put on the agenda</button>
                    )}
                    <button type="button" className={SMALL} onClick={() => void api.writeClipboardRich(value.draft).then(() => toast.success('Copied'))}>Copy</button>
                    <button type="button" className={SMALL} onClick={() => setDeciding({ id, text: '' })}>Resolved</button>
                    <button type="button" className={SMALL} onClick={() => void portfolio.setRecordValue('escalations', id, { ...value, status: 'dismissed', resolved: today }, 'Dismissed')}>Dismiss</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section data-pro-owed>
          <h2 className="mb-2 text-section text-text">Decisions needed</h2>
          {owed.length === 0 && <p className="text-meta text-text-secondary">None open.</p>}
          <ul className="divide-y divide-border">
            {owed.map(({ id, value }) => (
              <li key={id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 text-task-title text-text">{value.what}</span>
                <span className="text-meta text-text-secondary">{typeof value.from === 'number' ? personName(value.from) : 'nobody named'}, {diffLocalDays(value.opened, today)} days</span>
                <button type="button" className={SMALL} onClick={() => void portfolio.setRecordValue('owed', id, { ...value, resolved: today }, 'Decided')}>Decided</button>
              </li>
            ))}
          </ul>
        </section>

        {noCapacity.length > 0 && (
          <section>
            <h2 className="mb-2 text-section text-text">Capacity not agreed</h2>
            <ul className="space-y-1 text-task-title text-text">
              {noCapacity.map((entry) => <li key={entry.projectId}>{entry.rank}. {portfolio.titleOf(entry.projectId)}</li>)}
            </ul>
          </section>
        )}
      </div>
    </ReadingScroll>
  )
}
