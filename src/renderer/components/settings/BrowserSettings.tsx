import { useState, useEffect, useCallback } from 'react'
import type { AppConfig } from '@/lib/vikunja-types'

interface BrowserSettingsProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
  disabled?: boolean
}

export function BrowserSettings({ config, onChange, disabled }: BrowserSettingsProps) {
  const [expanded, setExpanded] = useState(false)
  const [showSetupInfo, setShowSetupInfo] = useState(false)
  const [regStatus, setRegStatus] = useState<{ chrome: boolean; firefox: boolean } | null>(null)
  const [registering, setRegistering] = useState(false)
  const mode = config.browser_link_mode ?? 'ask'

  useEffect(() => {
    if (expanded && mode !== 'off') {
      window.api.checkBrowserHostRegistration().then(setRegStatus)
    }
  }, [expanded, mode])

  const handleRegister = useCallback(async () => {
    setRegistering(true)
    try {
      const result = await window.api.registerBrowserHosts()
      setRegStatus(result)
    } catch { /* ignore */ }
    setRegistering(false)
  }, [])

  return (
    <div className={`rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5${disabled ? ' opacity-50 pointer-events-none' : ''}`}>
      <button
        type="button"
        className="flex w-full items-center justify-between pointer-events-auto"
        onClick={() => !disabled && setExpanded(!expanded)}
      >
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          Browser Integration{disabled ? ' (requires Quick Entry)' : ''}
        </h2>
        {!disabled && <span className="text-xs text-[var(--text-secondary)]">{expanded ? '\u25B2' : '\u25BC'}</span>}
      </button>

      {!disabled && expanded && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Page Linking</label>
            <select
              value={mode}
              onChange={(e) => onChange({ browser_link_mode: e.target.value as 'off' | 'ask' | 'always' })}
              className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none"
            >
              <option value="off">Off</option>
              <option value="ask">Ask ({window.api.platform === 'darwin' ? '\u2318L' : 'Ctrl+L'})</option>
              <option value="always">Always auto-link</option>
            </select>
          </div>

          {mode !== 'off' && (
            <>
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">Chrome Extension ID (optional)</label>
                <input
                  type="text"
                  value={config.browser_extension_id ?? ''}
                  onChange={(e) => onChange({ browser_extension_id: e.target.value })}
                  placeholder="For instant detection — leave blank to use auto-detect"
                  className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-accent-blue focus:outline-none"
                />
              </div>

              {regStatus && (
                <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                  {config.browser_extension_id && (
                    <span className="flex items-center gap-1">
                      <span className={`inline-block h-2 w-2 rounded-full ${regStatus.chrome ? 'bg-accent-green' : 'bg-[var(--text-secondary)]'}`} />
                      Chrome bridge: {regStatus.chrome ? 'Registered' : 'Not registered'}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <span className={`inline-block h-2 w-2 rounded-full ${regStatus.firefox ? 'bg-accent-green' : 'bg-[var(--text-secondary)]'}`} />
                    Firefox bridge: {regStatus.firefox ? 'Registered' : 'Not registered'}
                  </span>
                </div>
              )}

              {config.browser_extension_id && (
                <button
                  type="button"
                  onClick={handleRegister}
                  disabled={registering}
                  className="rounded-md border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  {registering ? 'Registering...' : 'Re-register Bridge'}
                </button>
              )}

              <div>
                <button
                  type="button"
                  onClick={() => setShowSetupInfo(!showSetupInfo)}
                  className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  How to set up {showSetupInfo ? '\u25BC' : '\u25B6'}
                </button>
                {showSetupInfo && (
                  <div className="mt-2 rounded-lg bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]">
                    <p className="mb-2 font-semibold">How it works</p>
                    <p className="mb-3">
                      {window.api.platform === 'darwin'
                        ? 'Vicu reads the URL from the active browser tab using AppleScript when Quick Entry opens. This works with Chrome, Safari, Edge, Brave, Opera, Vivaldi, and Arc. Firefox has limited support.'
                        : 'Vicu automatically reads the URL bar from the active browser window when Quick Entry opens. This works with Chrome, Firefox, Edge, Brave, Opera, and Vivaldi.'}
                      {' '}Browser extensions provide instant (&lt;1ms) detection; without them Vicu falls back to{' '}
                      {window.api.platform === 'darwin' ? 'AppleScript' : 'Windows accessibility APIs'} (~300ms).
                    </p>
                    {window.api.platform === 'darwin' && (
                      <p className="mb-3">
                        No setup needed for Chrome, Safari, Edge, Brave, Vivaldi, and Arc. On first use, macOS will ask you to allow Vicu to control the browser.
                      </p>
                    )}

                    <p className="mb-2 font-semibold">Firefox (extension for instant detection)</p>
                    {window.api.platform === 'darwin' && (
                      <p className="mb-2">
                        Firefox fallback detection via AppleScript is unreliable on macOS. Installing the extension is strongly recommended for Firefox support.
                      </p>
                    )}
                    <p>
                      Open the{' '}
                      <button
                        type="button"
                        onClick={() => window.api.openBrowserExtensionFolder()}
                        className="inline cursor-pointer text-accent-blue underline hover:text-accent-blue/80"
                      >extensions/browser</button>
                      {' '}folder and locate the <code className="rounded bg-[var(--bg-primary)] px-1">.xpi</code> file
                    </p>
                    <p>Open Firefox and go to <code className="rounded bg-[var(--bg-primary)] px-1">about:addons</code></p>
                    <p>Click the gear icon &rarr; &ldquo;Install Add-on From File&hellip;&rdquo;</p>
                    <p>Select the <code className="rounded bg-[var(--bg-primary)] px-1">.xpi</code> file and click &ldquo;Add&rdquo;</p>
                    <p className="mb-3">Then click &ldquo;Re-register Bridge&rdquo; above</p>

                    <p className="mb-2 font-semibold">Chrome (optional extension for instant detection)</p>
                    <p>
                      Chrome works without the extension, but installing it provides instant (&lt;1ms)
                      detection instead of the ~300ms fallback.
                    </p>
                    <p>Open <code className="rounded bg-[var(--bg-primary)] px-1">chrome://extensions</code></p>
                    <p>Enable &ldquo;Developer mode&rdquo; (top-right toggle)</p>
                    <p>
                      Click &ldquo;Load unpacked&rdquo; &rarr; select the{' '}
                      <button
                        type="button"
                        onClick={() => window.api.openBrowserExtensionFolder()}
                        className="inline cursor-pointer text-accent-blue underline hover:text-accent-blue/80"
                      >extensions/browser</button>
                      {' '}folder
                    </p>
                    <p>Copy the Extension ID shown on the card and paste it in the field above</p>
                    <p className="mb-3">Then click &ldquo;Re-register Bridge&rdquo; above</p>

                    <p className="mb-2 font-semibold">
                      {window.api.platform === 'darwin'
                        ? 'Safari, Arc, Edge, Brave, Opera, Vivaldi'
                        : 'Edge, Brave, Opera, Vivaldi'}
                    </p>
                    <p className="mb-3">
                      No setup needed. Vicu detects URLs automatically via{' '}
                      {window.api.platform === 'darwin' ? 'AppleScript' : 'accessibility APIs'}.
                    </p>

                    <p className="mt-2 border-t border-[var(--border-color)] pt-2">
                      Open Quick Entry while a browser tab is active to see the link hint.
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
