import { useMemo, useState } from 'react'
import { Copy, Printer } from 'lucide-react'
import { Dialog } from '@/components/overlay/Dialog'
import { useProLedger } from '@/hooks/use-pro-ledger'
import { usePortfolio } from '@/hooks/use-portfolio'
import { usePersonLabels } from '@/hooks/use-people'
import { api } from '@/lib/api'
import { toast } from '@/stores/toast-store'
import { toLocalDate } from '../../../shared/due-dates'
import { buildImpact, quarterOf } from '../../../shared/pro/impact'

const ACTION = 'inline-flex items-center gap-1.5 rounded-control border border-border px-2.5 py-1 text-meta text-text hover:bg-bg-hover'

/**
 * The quarterly impact summary (plan 7.7.6): what this or the last quarter delivered, from the
 * ledger, plus a line about your own growth that only goes into the copy. Copy and print.
 */
export function ImpactSummary({ onClose }: { onClose: () => void }) {
  const { ledger } = useProLedger()
  const portfolio = usePortfolio()
  const people = usePersonLabels()
  const [back, setBack] = useState(0)
  const [growth, setGrowth] = useState('')
  const quarter = quarterOf(toLocalDate(new Date()), back)
  const impact = useMemo(
    () => buildImpact({ ledger, quarter, growth, projectName: portfolio.titleOf, personName: (id) => people.get(id)?.title ?? 'someone' }),
    [ledger, quarter.from, growth, portfolio.titleOf, people],
  )

  const copy = async () => {
    await api.writeClipboardRich(impact.text, impact.html)
    toast.success('Impact summary copied')
  }
  const print = async () => {
    const result = await api.printHtml(impact.html)
    if (!result.success) toast.error(result.error)
  }

  return (
    <Dialog open label="Quarterly impact" onClose={onClose} className="w-[560px] max-w-[92vw] p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-card-title text-text">Impact, {quarter.name}</h2>
        <div role="radiogroup" aria-label="Quarter" className="flex rounded-control border border-border p-0.5">
          {[0, 1].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={back === value}
              onClick={() => setBack(value)}
              className={back === value ? 'rounded-control bg-bg-selected px-2 py-0.5 text-meta text-text' : 'rounded-control px-2 py-0.5 text-meta text-text-secondary hover:bg-bg-hover'}
            >
              {value === 0 ? 'This quarter' : 'Last quarter'}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[50vh] space-y-3 overflow-y-auto" data-pro-impact>
        {impact.sections.filter((section) => section.heading !== 'Growth').map((section) => (
          <section key={section.heading}>
            <h3 className="mb-1 text-meta font-medium text-text">{section.heading}</h3>
            <ul className="list-disc space-y-0.5 pl-5 text-meta text-text">
              {section.lines.map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </section>
        ))}
        {impact.sections.every((section) => section.heading === 'Growth') && (
          <p className="text-meta text-text-secondary">Nothing recorded this quarter. Value notes, decisions and verdicts show here.</p>
        )}
      </div>
      <label className="mt-4 block">
        <span className="mb-1 block text-meta text-text-secondary">Growth (only in the copy)</span>
        <textarea
          value={growth}
          onChange={(event) => setGrowth(event.target.value)}
          rows={2}
          placeholder="One thing you learned or got better at"
          className="w-full resize-y rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text"
        />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={ACTION} onClick={() => void copy()}><Copy className="h-3.5 w-3.5" aria-hidden /> Copy</button>
        <button type="button" className={ACTION} onClick={() => void print()}><Printer className="h-3.5 w-3.5" aria-hidden /> Print</button>
        <button type="button" className="rounded-control bg-accent-fill px-3 py-1.5 text-meta font-medium text-on-accent" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  )
}
