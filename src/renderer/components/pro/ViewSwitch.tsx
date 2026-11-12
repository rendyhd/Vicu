import { cn } from '@/lib/cn'
import type { AvailabilityView } from '../../../shared/pro/availability'

const VIEWS: Array<{ value: AvailabilityView; label: string; note: string }> = [
  { value: 'available', label: 'Available', note: 'Open tasks you can do now' },
  { value: 'remaining', label: 'Remaining', note: 'Every open task' },
  { value: 'all', label: 'All', note: 'Open and done tasks' },
]

/** Available, Remaining or All (cross-app semantics 21.2), above a list while Pro's first layer is on. */
export function ViewSwitch({ view, onChange }: { view: AvailabilityView; onChange: (view: AvailabilityView) => void }) {
  return (
    <div className="flex gap-1 px-6 pb-2" role="radiogroup" aria-label="Show" data-pro-view-switch>
      {VIEWS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={view === option.value}
          title={option.note}
          data-pro-view={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-chip border px-2 py-0.5 text-meta',
            view === option.value
              ? 'border-accent-blue bg-accent-blue/12 text-accent-blue'
              : 'border-border text-text-secondary hover:bg-bg-hover',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Under an Available list: how many open tasks wait, with a way to see them. */
export function HiddenSummary({ count, onShow }: { count: number; onShow: () => void }) {
  if (count <= 0) return null
  return (
    <div className="px-6 py-3 text-meta text-text-secondary" data-pro-hidden-summary>
      {count === 1 ? '1 task is not available yet.' : `${count} tasks are not available yet.`}{' '}
      <button type="button" className="font-medium text-accent-blue hover:underline" onClick={onShow}>
        Show remaining
      </button>
    </div>
  )
}
