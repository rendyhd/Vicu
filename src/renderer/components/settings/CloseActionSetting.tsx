import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../../shared/i18n'
import { closeAction, type AppConfig, type CloseAction } from '@/lib/vikunja-types'

const OPTIONS: ReadonlyArray<{ value: CloseAction; label: TranslationKey }> = [
  { value: 'minimize', label: 'settings.closeAction.minimize' },
  { value: 'tray', label: 'settings.closeAction.tray' },
  { value: 'quit', label: 'settings.closeAction.quit' },
]

const NOTES: Record<CloseAction, TranslationKey> = {
  minimize: 'settings.closeAction.minimizeNote',
  tray: 'settings.closeAction.trayNote',
  quit: 'settings.closeAction.quitNote',
}

/**
 * What the main window's close button does (Windows and Linux; macOS always hides to the Dock).
 * Unset shows what it does today: the tray while Quick Entry or Quick View is on, else quit.
 */
export function CloseActionSetting({
  config,
  onChange,
}: {
  config: AppConfig | null
  onChange: (patch: Partial<AppConfig>) => void
}) {
  const { t } = useTranslation()
  const current = closeAction(config)
  return (
    <label className="flex items-center justify-between gap-4">
      <span>
        <span className="block text-sm text-[var(--text-primary)]">{t('settings.closeAction.label')}</span>
        <span className="block text-xs text-[var(--text-secondary)]">{t(NOTES[current])}</span>
      </span>
      <select
        value={current}
        onChange={(e) => onChange({ close_action: e.target.value as CloseAction })}
        className="rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{t(option.label)}</option>
        ))}
      </select>
    </label>
  )
}
