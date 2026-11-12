import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, PauseCircle, Play } from 'lucide-react'
import { cn } from '@/lib/cn'
import { usePortfolio } from '@/hooks/use-portfolio'
import { usePro } from '@/hooks/use-pro'
import { usePersonLabels } from '@/hooks/use-people'
import { ReadingScroll } from '@/components/layout/ReadingScroll'
import { PageHeader } from '@/components/shared/PageHeader'
import { ProOffNotice } from '@/components/pro/ProOffNotice'
import { ParkDialog } from '@/components/pro/ParkDialog'
import { ImpactSummary } from '@/components/pro/ImpactSummary'
import { readiness } from '../../../shared/pro/portfolio'
import { recordValue } from '../../../shared/pro/ledger'

const ICON = 'rounded-control p-1 text-text-secondary hover:bg-bg-hover hover:text-text disabled:opacity-30'

/**
 * The portfolio (cross-app semantics 21.10, plan 7.6.2): active initiatives by rank against the cap,
 * then parked and closed ones. Moving one logs a decision; parking asks why.
 */
export function PortfolioView() {
  const pro = usePro()
  const portfolio = usePortfolio()
  const people = usePersonLabels()
  const navigate = useNavigate()
  const [parking, setParking] = useState<number | null>(null)
  const [impactOpen, setImpactOpen] = useState(false)
  const powerOn = pro.layer('power')
  if (!pro.layer('portfolio')) return <ProOffNotice title="Portfolio" />

  const others = Object.keys(portfolio.ledger.initiatives).flatMap((id) => {
    const value = recordValue(portfolio.ledger.initiatives, id)
    return value && value.status !== 'active' && value.status !== undefined ? [{ id: Number(id), value }] : []
  })
  const parked = others.filter((entry) => entry.value.status === 'parked')
  const closed = others.filter((entry) => entry.value.status === 'closed')
  const name = (id: number | null | undefined) => (typeof id === 'number' ? people.get(id)?.title ?? 'someone' : null)
  const open = (id: number) => navigate({ to: '/project/$projectId', params: { projectId: String(id) } })

  return (
    <ReadingScroll className="bg-[var(--bg-primary)]" columnClassName="flex flex-col">
      <PageHeader
        title="Portfolio"
        inScroll
        actions={powerOn ? (
          <button type="button" className="inline-flex items-center gap-1.5 rounded-control border border-border px-2.5 py-1 text-meta text-text hover:bg-bg-hover" onClick={() => setImpactOpen(true)}>
            Quarterly impact
          </button>
        ) : undefined}
      />
      {impactOpen && <ImpactSummary onClose={() => setImpactOpen(false)} />}
      <div className="mx-auto w-full max-w-reading px-6 pb-10">
        <div className="mb-4" data-pro-cap>
          <div className="mb-1 flex items-center justify-between text-meta text-text">
            <span>{portfolio.cap.active} of {portfolio.cap.cap} active{portfolio.cap.agreed ? ', agreed' : ', not agreed yet'}</span>
            {portfolio.cap.full && <span className="text-status-overdue">At the cap: park one before starting another</span>}
          </div>
          <div className="flex h-2 gap-1" aria-hidden>
            {Array.from({ length: Math.max(portfolio.cap.cap, portfolio.cap.active) }, (_, index) => (
              <span key={index} className={cn('flex-1 rounded-full', index < portfolio.cap.active ? (index < portfolio.cap.cap ? 'bg-accent-purple' : 'bg-status-overdue') : 'bg-bg-hover')} />
            ))}
          </div>
        </div>

        {portfolio.ranked.length === 0 && (
          <p className="py-6 text-sm text-text-secondary">No initiatives yet. Open a project&apos;s menu and choose Make this an initiative.</p>
        )}
        <ol className="divide-y divide-border rounded-card border border-border" data-pro-portfolio>
          {portfolio.ranked.map((entry, index) => {
            const ready = readiness(entry.value)
            return (
              <li key={entry.projectId} className="flex items-center gap-3 px-3 py-2.5" data-pro-initiative={entry.projectId}>
                <span className="w-6 text-right text-section text-text-secondary">{entry.rank}</span>
                <button type="button" className="min-w-0 flex-1 truncate text-left text-task-title text-text hover:underline" onClick={() => open(entry.projectId)}>
                  {portfolio.titleOf(entry.projectId)}
                </button>
                <span className="hidden text-meta text-text-secondary sm:inline">{name(entry.value.owner) ? `Owner ${name(entry.value.owner)}` : 'No owner'}</span>
                <span className={cn('text-meta', ready.ready ? 'text-text-secondary' : 'text-status-overdue')}>Ready {ready.done}/{ready.total}</span>
                <button type="button" aria-label="Move up" disabled={index === 0} className={ICON} onClick={() => void portfolio.move(entry.projectId, index - 1)}><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" aria-label="Move down" disabled={index === portfolio.ranked.length - 1} className={ICON} onClick={() => void portfolio.move(entry.projectId, index + 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
                <button type="button" aria-label="Park" className={ICON} onClick={() => setParking(entry.projectId)}><PauseCircle className="h-3.5 w-3.5" /></button>
              </li>
            )
          })}
        </ol>

        {parked.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-section text-text">Parked</h2>
            <ul className="divide-y divide-border">
              {parked.map(({ id, value }) => (
                <li key={id} className="flex items-center gap-3 px-2 py-2">
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-task-title text-text hover:underline" onClick={() => open(id)}>{portfolio.titleOf(id)}</button>
                  <span className="min-w-0 truncate text-meta text-text-secondary">{value.parked?.reason || 'No reason given'}</span>
                  <button
                    type="button"
                    disabled={portfolio.cap.full}
                    title={portfolio.cap.full ? 'At the cap: park one first' : undefined}
                    className="inline-flex items-center gap-1 rounded-control border border-border px-2 py-0.5 text-meta text-text hover:bg-bg-hover disabled:opacity-40"
                    onClick={() => void portfolio.unpark(id)}
                  >
                    <Play className="h-3 w-3" aria-hidden /> Make active
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {closed.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-section text-text">Closed</h2>
            <ul className="space-y-1 px-2 text-meta text-text-secondary">
              {closed.map(({ id, value }) => <li key={id}>{portfolio.titleOf(id)}{value.closed_on ? `, ${value.closed_on}` : ''}</li>)}
            </ul>
          </section>
        )}
      </div>
      {parking !== null && <ParkDialog projectId={parking} onClose={() => setParking(null)} />}
    </ReadingScroll>
  )
}
