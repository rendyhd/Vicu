import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

/** A Pro page opened while Pro (or its layer) is off, from a link or the history: says so, changes nothing. */
export function ProOffNotice({ title }: { title: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="text-lg font-semibold text-text">{title}</h1>
      <p className="max-w-sm text-sm text-text-secondary">{t('pro.offNotice.text')}</p>
      <button
        type="button"
        className="mt-2 text-sm font-medium text-accent-blue hover:underline"
        onClick={() => navigate({ to: '/settings', search: { section: 'pro' } })}
      >
        {t('pro.offNotice.settings')}
      </button>
    </div>
  )
}
