import { Button } from '@/components/shared/Button'
import { useState, useCallback } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { AppConfig } from '@/lib/vikunja-types'

interface ObsidianSettingsProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
  disabled?: boolean
}

export function ObsidianSettings({ config, onChange, disabled }: ObsidianSettingsProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [showSetupInfo, setShowSetupInfo] = useState(false)
  const [testStatus, setTestStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'idle' })
  const mode = config.obsidian_mode ?? 'ask'

  const handleTest = useCallback(async () => {
    setTestStatus({ type: 'loading' })
    try {
      const result = await window.api.testObsidianConnection()
      if (result.success) {
        setTestStatus({ type: 'success' })
      } else {
        setTestStatus({ type: 'error', message: result.error || undefined })
      }
    } catch {
      setTestStatus({ type: 'error' })
    }
  }, [])

  return (
    <div className={`rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5${disabled ? ' opacity-50 pointer-events-none' : ''}`}>
      <button
        type="button"
        className="flex w-full items-center justify-between pointer-events-auto"
        onClick={() => !disabled && setExpanded(!expanded)}
      >
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          {disabled ? t('settings.obsidian.titleDisabled') : t('settings.obsidian.title')}
        </h2>
        {!disabled && <span className="text-xs text-[var(--text-secondary)]">{expanded ? '\u25B2' : '\u25BC'}</span>}
      </button>

      {!disabled && expanded && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">{t('settings.obsidian.noteLinking.label')}</label>
            <select
              value={mode}
              onChange={(e) => onChange({ obsidian_mode: e.target.value as 'off' | 'ask' | 'always' })}
              className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="off">{t('settings.obsidian.noteLinking.off')}</option>
              {/* i18n-ignore: keyboard shortcut */}
              <option value="ask">{t('settings.obsidian.noteLinking.ask', { shortcut: window.api.platform === 'darwin' ? '\u2318L' : 'Ctrl+L' })}</option>
              <option value="always">{t('settings.obsidian.noteLinking.always')}</option>
            </select>
          </div>

          {mode !== 'off' && (
            <>
              <div>
                <button
                  type="button"
                  onClick={() => setShowSetupInfo(!showSetupInfo)}
                  className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  {t('settings.obsidian.setup.toggle', { arrow: showSetupInfo ? '\u25BC' : '\u25B6' })}
                </button>
                {showSetupInfo && (
                  <div className="mt-2 rounded-card bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]">
                    <p className="mb-2">
                      <Trans i18nKey="settings.obsidian.setup.rest.title" components={{ name: <span className="font-semibold" /> }} />
                    </p>
                    <p>{t('settings.obsidian.setup.rest.step1')}</p>
                    <p>{t('settings.obsidian.setup.rest.step2')}</p>
                    <p>{t('settings.obsidian.setup.rest.step3')}</p>
                    <p>{t('settings.obsidian.setup.rest.step4')}</p>
                    <p className="mb-3">{t('settings.obsidian.setup.rest.step5')}</p>

                    <p className="mb-2">
                      <Trans i18nKey="settings.obsidian.setup.uri.title" components={{ name: <span className="font-semibold" /> }} />
                    </p>
                    <p>{t('settings.obsidian.setup.uri.step1')}</p>
                    <p>{t('settings.obsidian.setup.uri.step2')}</p>
                    <p>{t('settings.obsidian.setup.uri.step3')}</p>
                    <p><Trans i18nKey="settings.obsidian.setup.uri.step4" components={{ prop: <code /> }} /></p>

                    <p className="mt-2 border-t border-[var(--border-color)] pt-2">
                      {t('settings.obsidian.setup.done')}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">{t('settings.obsidian.apiKey.label')}</label>
                <div className="flex gap-2">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={config.obsidian_api_key ?? ''}
                    onChange={(e) => onChange({ obsidian_api_key: e.target.value })}
                    placeholder={t('settings.obsidian.apiKey.placeholder')}
                    className="flex-1 rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
                  />
                  <Button variant="quiet" onClick={() => setShowKey(!showKey)}>
                    {showKey ? t('settings.obsidian.apiKey.hide') : t('settings.obsidian.apiKey.show')}
                  </Button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">{t('settings.obsidian.vaultName.label')}</label>
                <input
                  type="text"
                  value={config.obsidian_vault_name ?? ''}
                  onChange={(e) => onChange({ obsidian_vault_name: e.target.value })}
                  placeholder={t('settings.obsidian.vaultName.placeholder')}
                  className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">{t('settings.obsidian.port.label')}</label>
                <input
                  type="number"
                  value={config.obsidian_port ?? 27124}
                  onChange={(e) => onChange({ obsidian_port: Number(e.target.value) || 27124 })}
                  className="w-32 rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </div>

              <div>
                <Button variant="secondary" onClick={handleTest} disabled={testStatus.type === 'loading'}>
                  {testStatus.type === 'loading' ? t('settings.obsidian.test.testing') : t('settings.obsidian.test.button')}
                </Button>
                {testStatus.type === 'success' && (
                  <span className="ml-2 text-xs text-status-done">{t('settings.obsidian.test.connected')}</span>
                )}
                {testStatus.type === 'error' && (
                  <span className="ml-2 text-xs text-danger">{testStatus.message ?? t('settings.obsidian.test.failed')}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
