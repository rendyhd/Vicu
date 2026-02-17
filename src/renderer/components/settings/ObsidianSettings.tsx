import { useState, useCallback } from 'react'
import type { AppConfig } from '@/lib/vikunja-types'

interface ObsidianSettingsProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
}

export function ObsidianSettings({ config, onChange }: ObsidianSettingsProps) {
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
        setTestStatus({ type: 'success', message: 'Connected' })
      } else {
        setTestStatus({ type: 'error', message: result.error || 'Connection failed' })
      }
    } catch {
      setTestStatus({ type: 'error', message: 'Connection failed' })
    }
  }, [])

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <button
        type="button"
        className="flex w-full items-center justify-between"
        onClick={() => setExpanded(!expanded)}
      >
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Obsidian Integration</h2>
        <span className="text-xs text-[var(--text-secondary)]">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Note Linking</label>
            <select
              value={mode}
              onChange={(e) => onChange({ obsidian_mode: e.target.value as 'off' | 'ask' | 'always' })}
              className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none"
            >
              <option value="off">Off</option>
              <option value="ask">Ask (Ctrl+L)</option>
              <option value="always">Always auto-link</option>
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
                  How to set up Obsidian {showSetupInfo ? '\u25BC' : '\u25B6'}
                </button>
                {showSetupInfo && (
                  <div className="mt-2 rounded-lg bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]">
                    <p className="mb-2">
                      <span className="font-semibold">1. Local REST API</span> (by Adam Coddington)
                    </p>
                    <p>Open Obsidian &rarr; Settings (gear icon, bottom-left) &rarr; Community Plugins &rarr; Browse</p>
                    <p>Search &ldquo;Local REST API&rdquo; &rarr; Install &rarr; Enable</p>
                    <p>Go back to Settings &rarr; scroll to &ldquo;Local REST API&rdquo; under Community Plugins</p>
                    <p>The API Key is shown at the top of the plugin&apos;s settings panel &mdash; click the copy button and paste it below</p>
                    <p className="mb-3">Leave all other settings at their defaults (HTTPS on port 27124)</p>

                    <p className="mb-2">
                      <span className="font-semibold">2. Advanced URI</span> (by Vinzent03)
                    </p>
                    <p>Same steps &mdash; search &ldquo;Advanced URI&rdquo; in Community Plugins &rarr; Install &rarr; Enable</p>
                    <p>In the plugin settings, turn on &ldquo;Use UID instead of file paths&rdquo;</p>
                    <p>This makes note links survive file renames. All other settings can stay at their defaults.</p>

                    <p className="mt-2 border-t border-[var(--border-color)] pt-2">
                      Once both plugins are enabled and Obsidian is running, click Test Connection below to verify.
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">API Key</label>
                <div className="flex gap-2">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={config.obsidian_api_key ?? ''}
                    onChange={(e) => onChange({ obsidian_api_key: e.target.value })}
                    placeholder="Obsidian > Settings > Local REST API > Copy API Key"
                    className="flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-accent-blue focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="rounded-md border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">Vault Name</label>
                <input
                  type="text"
                  value={config.obsidian_vault_name ?? ''}
                  onChange={(e) => onChange({ obsidian_vault_name: e.target.value })}
                  placeholder="Shown in Obsidian's title bar"
                  className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-accent-blue focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">Port</label>
                <input
                  type="number"
                  value={config.obsidian_port ?? 27124}
                  onChange={(e) => onChange({ obsidian_port: Number(e.target.value) || 27124 })}
                  className="w-32 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none"
                />
              </div>

              <div>
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testStatus.type === 'loading'}
                  className="rounded-md border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  {testStatus.type === 'loading' ? 'Testing...' : 'Test Connection'}
                </button>
                {testStatus.type === 'success' && (
                  <span className="ml-2 text-xs text-green-600 dark:text-green-400">{testStatus.message}</span>
                )}
                {testStatus.type === 'error' && (
                  <span className="ml-2 text-xs text-accent-red">{testStatus.message}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
