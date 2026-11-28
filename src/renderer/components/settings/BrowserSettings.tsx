import { Button } from '@/components/shared/Button'
import { useState, useEffect, useCallback } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { AppConfig } from '@/lib/vikunja-types'

interface BrowserSettingsProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
  disabled?: boolean
}

export function BrowserSettings({ config, onChange, disabled }: BrowserSettingsProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [showSetupInfo, setShowSetupInfo] = useState(false)
  const [regStatus, setRegStatus] = useState<{ chrome: boolean; firefox: boolean } | null>(null)
  const [registering, setRegistering] = useState(false)
  const mode = config.browser_link_mode ?? 'ask'

  const handleRegister = useCallback(async () => {
    setRegistering(true)
    try {
      const result = await window.api.registerBrowserHosts()
      setRegStatus(result)
    } catch { /* ignore */ }
    setRegistering(false)
  }, [])

  useEffect(() => {
    if (!expanded || mode === 'off') return
    let cancelled = false
    window.api.checkBrowserHostRegistration().then((status) => {
      if (cancelled) return
      setRegStatus(status)
      // If the user toggled browser link on but nothing is registered yet,
      // write the manifests automatically so Firefox-only users don't have
      // to hunt for a button.
      if (!status.chrome && !status.firefox) {
        handleRegister()
      }
    })
    return () => { cancelled = true }
  }, [expanded, mode, handleRegister])

  return (
    <div className={`rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5${disabled ? ' opacity-50 pointer-events-none' : ''}`}>
      <button
        type="button"
        className="flex w-full items-center justify-between pointer-events-auto"
        onClick={() => !disabled && setExpanded(!expanded)}
      >
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          {disabled ? t('settings.browser.titleDisabled') : t('settings.browser.title')}
        </h2>
        {!disabled && <span className="text-xs text-[var(--text-secondary)]">{expanded ? '\u25B2' : '\u25BC'}</span>}
      </button>

      {!disabled && expanded && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">{t('settings.browser.pageLinking.label')}</label>
            <select
              value={mode}
              onChange={(e) => onChange({ browser_link_mode: e.target.value as 'off' | 'ask' | 'always' })}
              className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="off">{t('settings.browser.pageLinking.off')}</option>
              {/* i18n-ignore: keyboard shortcut */}
              <option value="ask">{t('settings.browser.pageLinking.ask', { shortcut: window.api.platform === 'darwin' ? '\u2318L' : 'Ctrl+L' })}</option>
              <option value="always">{t('settings.browser.pageLinking.always')}</option>
            </select>
          </div>

          {mode !== 'off' && (
            <>
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">{t('settings.browser.extensionId.label')}</label>
                <input
                  type="text"
                  value={config.browser_extension_id ?? ''}
                  onChange={(e) => onChange({ browser_extension_id: e.target.value })}
                  placeholder={t('settings.browser.extensionId.placeholder')}
                  className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
                />
              </div>

              {regStatus && (
                <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                  {config.browser_extension_id && (
                    <span className="flex items-center gap-1">
                      <span className={`inline-block h-2 w-2 rounded-full ${regStatus.chrome ? 'bg-status-done' : 'bg-[var(--text-secondary)]'}`} />
                      {regStatus.chrome ? t('settings.browser.bridge.chromeRegistered') : t('settings.browser.bridge.chromeNotRegistered')}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <span className={`inline-block h-2 w-2 rounded-full ${regStatus.firefox ? 'bg-status-done' : 'bg-[var(--text-secondary)]'}`} />
                    {regStatus.firefox ? t('settings.browser.bridge.firefoxRegistered') : t('settings.browser.bridge.firefoxNotRegistered')}
                  </span>
                </div>
              )}

              <Button variant="secondary" onClick={handleRegister} disabled={registering}>
                {registering ? t('settings.browser.bridge.registering') : t('settings.browser.bridge.reRegister')}
              </Button>

              <div>
                <button
                  type="button"
                  onClick={() => setShowSetupInfo(!showSetupInfo)}
                  className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  {t('settings.browser.setup.toggle', { arrow: showSetupInfo ? '\u25BC' : '\u25B6' })}
                </button>
                {showSetupInfo && (
                  <div className="mt-2 rounded-card bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]">
                    <p className="mb-2 font-semibold">{t('settings.browser.setup.howItWorks')}</p>
                    <p className="mb-3">
                      {window.api.platform === 'darwin' ? t('settings.browser.setup.introMac') : t('settings.browser.setup.introOther')}
                    </p>
                    {window.api.platform === 'darwin' && (
                      <p className="mb-3">
                        {t('settings.browser.setup.macNoSetup')}
                      </p>
                    )}

                    <p className="mb-2 font-semibold">{t('settings.browser.firefox.title')}</p>
                    {window.api.platform === 'darwin' && (
                      <p className="mb-2">
                        {t('settings.browser.firefox.macWarning')}
                      </p>
                    )}
                    <p><Trans i18nKey="settings.browser.firefox.step1" components={{ folder: <button
                        type="button"
                        onClick={() => window.api.openBrowserExtensionFolder()}
                        className="inline cursor-pointer text-accent-blue underline hover:text-accent-blue/80"
                      />, code: <code className="rounded-control bg-[var(--bg-primary)] px-1" /> }} /></p>
                    <p><Trans i18nKey="settings.browser.firefox.step2" components={{ code: <code className="rounded-control bg-[var(--bg-primary)] px-1" /> }} /></p>
                    <p>{t('settings.browser.firefox.step3')}</p>
                    <p><Trans i18nKey="settings.browser.firefox.step4" components={{ code: <code className="rounded-control bg-[var(--bg-primary)] px-1" /> }} /></p>
                    <p className="mb-3">{t('settings.browser.reRegisterHint')}</p>

                    <p className="mb-2 font-semibold">{t('settings.browser.chrome.title')}</p>
                    <p>
                      {t('settings.browser.chrome.intro')}
                    </p>
                    <p><Trans i18nKey="settings.browser.chrome.step1" components={{ code: <code className="rounded-control bg-[var(--bg-primary)] px-1" /> }} /></p>
                    <p>{t('settings.browser.chrome.step2')}</p>
                    <p><Trans i18nKey="settings.browser.chrome.step3" components={{ folder: <button
                        type="button"
                        onClick={() => window.api.openBrowserExtensionFolder()}
                        className="inline cursor-pointer text-accent-blue underline hover:text-accent-blue/80"
                      /> }} /></p>
                    <p>{t('settings.browser.chrome.step4')}</p>
                    <p className="mb-3">{t('settings.browser.reRegisterHint')}</p>

                    <p className="mb-2 font-semibold">
                      {window.api.platform === 'darwin' ? t('settings.browser.others.titleMac') : t('settings.browser.others.titleOther')}
                    </p>
                    <p className="mb-3">
                      {window.api.platform === 'darwin' ? t('settings.browser.others.autoMac') : t('settings.browser.others.autoOther')}
                    </p>

                    <p className="mt-2 border-t border-[var(--border-color)] pt-2">
                      {t('settings.browser.setup.hint')}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
