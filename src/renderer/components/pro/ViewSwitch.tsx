import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import type { TranslationKey } from '../../../shared/i18n'
import type { AvailabilityView } from '../../../shared/pro/availability'

const VIEWS: Array<{ value: AvailabilityView; label: TranslationKey; note: TranslationKey }> = [
  { value: 'available', label: 'pro.viewSwitch.available', note: 'pro.viewSwitch.availableNote' },
  { value: 'remaining', label: 'pro.viewSwitch.remaining', note: 'pro.viewSwitch.remainingNote' },
  { value: 'all', label: 'pro.viewSwitch.all', note: 'pro.viewSwitch.allNote' },
]

/** Available, Remaining or All (cross-app semantics 21.2), above a list while Pro's first layer is on. */
export function ViewSwitch({ view, onChange }: { view: AvailabilityView; onChange: (view: AvailabilityView) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex gap-1 px-6 pb-2" role="radiogroup" aria-label={t('pro.viewSwitch.show')} data-pro-view-switch>
      {VIEWS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={view === option.value}
          title={t(option.note)}
          data-pro-view={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-chip border px-2 py-0.5 text-meta',
            view === option.value
              ? 'border-accent-blue bg-accent-blue/12 text-accent-blue'
              : 'border-border text-text-secondary hover:bg-bg-hover',
          )}
        >
          {t(option.label)}
        </button>
      ))}
    </div>
  )
}

/** Under an Available list: how many open tasks wait, with a way to see them. */
export function HiddenSummary({ count, onShow }: { count: number; onShow: () => void }) {
  const { t } = useTranslation()
  if (count <= 0) return null
  return (
    <div className="px-6 py-3 text-meta text-text-secondary" data-pro-hidden-summary>
      {t('pro.viewSwitch.hidden', { count })}{' '}
      <button type="button" className="font-medium text-accent-blue hover:underline" onClick={onShow}>
        {t('pro.viewSwitch.showRemaining')}
      </button>
    </div>
  )
}
