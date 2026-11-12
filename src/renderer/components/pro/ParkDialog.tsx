import { useState } from 'react'
import { Dialog } from '@/components/overlay/Dialog'
import { usePortfolio } from '@/hooks/use-portfolio'

/**
 * Parking an initiative (21.10): its tasks go on hold and leave Today, Upcoming, Available and
 * meetings. With `thenStart`, the cap was full: park one, then the other starts.
 */
export function ParkDialog({ projectId, thenStart, onClose }: { projectId: number | null; thenStart?: number; onClose: () => void }) {
  const portfolio = usePortfolio()
  const [chosen, setChosen] = useState<number | null>(projectId)
  const [reason, setReason] = useState('')
  const park = async () => {
    if (chosen === null) return
    await portfolio.park(chosen, reason)
    if (thenStart !== undefined) await portfolio.start(thenStart)
    onClose()
  }
  return (
    <Dialog open label="Park an initiative" onClose={onClose} className="w-[440px] max-w-[92vw] p-5">
      <h2 className="mb-1 text-card-title text-text">{thenStart !== undefined ? 'At the cap: park one first' : `Park ${portfolio.titleOf(projectId ?? 0)}`}</h2>
      <p className="mb-3 text-meta text-text-secondary">Its tasks wait until it is active again. The reason is kept with it.</p>
      {projectId === null && (
        <select value={chosen ?? ''} onChange={(event) => setChosen(event.target.value ? Number(event.target.value) : null)} aria-label="Initiative" className="mb-3 w-full rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text">
          <option value="">Choose one to park</option>
          {portfolio.ranked.map((entry) => <option key={entry.projectId} value={entry.projectId}>{entry.rank}. {portfolio.titleOf(entry.projectId)}</option>)}
        </select>
      )}
      <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why (optional)" aria-label="Reason" autoFocus className="w-full rounded-control border border-border bg-bg-page px-2 py-1.5 text-task-title text-text" />
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="rounded-control px-3 py-1.5 text-meta text-text hover:bg-bg-hover" onClick={onClose}>Cancel</button>
        <button type="button" disabled={chosen === null} className="rounded-control bg-accent-fill px-3 py-1.5 text-meta font-medium text-on-accent disabled:opacity-40" onClick={() => void park()}>Park</button>
      </div>
    </Dialog>
  )
}
