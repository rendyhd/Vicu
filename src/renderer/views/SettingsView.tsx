import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { applyTheme } from '@/lib/theme'
import { TokenPermissionsInfo } from '@/views/SetupView'
import { QuickEntrySettings } from '@/components/settings/QuickEntrySettings'
import { ObsidianSettings } from '@/components/settings/ObsidianSettings'
import { BrowserSettings } from '@/components/settings/BrowserSettings'
import { KeyboardShortcuts } from '@/components/settings/KeyboardShortcuts'
import { NotificationSettings } from '@/components/settings/NotificationSettings'
import type { AppConfig, Project } from '@/lib/vikunja-types'

import type { ThemeOption } from '@/lib/theme'

type SettingsTab = 'general' | 'notifications' | 'shortcuts'

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [inboxProjectId, setInboxProjectId] = useState(0)
  const [theme, setTheme] = useState<ThemeOption>('system')
  const [authMethod, setAuthMethod] = useState<'api_token' | 'oidc'>('api_token')

  const [projects, setProjects] = useState<Project[]>([])
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testError, setTestError] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [hotkeyWarnings, setHotkeyWarnings] = useState<{ entry: boolean; viewer: boolean } | undefined>(undefined)

  // Keep full config for preserving fields during save
  const [fullConfig, setFullConfig] = useState<AppConfig | null>(null)

  // Auto-save with debounce
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingConfigRef = useRef<AppConfig | null>(null)

  useEffect(() => {
    api.getConfig().then((config) => {
      if (config) {
        setFullConfig(config)
        setUrl(config.vikunja_url || '')
        setToken(config.api_token || '')
        setInboxProjectId(config.inbox_project_id || 0)
        setTheme(config.theme || 'system')
        setAuthMethod(config.auth_method || 'api_token')
      }
    })
  }, [])

  useEffect(() => {
    if (url && (token || authMethod === 'oidc')) {
      api.fetchProjects().then((res) => {
        if (res.success) setProjects(res.data)
      })
    }
  }, [url, token, authMethod])

  const handleTestConnection = async () => {
    setTestStatus('testing')
    setTestError('')
    const result = await api.testConnection(url, token)
    if (result.success) {
      setTestStatus('success')
      setProjects(result.data)
      // Auto-save connection settings on successful test
      handleQuickEntryChange({
        vikunja_url: url,
        api_token: authMethod === 'api_token' ? token : '',
        auth_method: authMethod,
      })
    } else {
      setTestStatus('error')
      setTestError(result.error)
    }
  }

  const flushSave = useCallback(async (config: AppConfig) => {
    setSaveStatus('saving')
    await api.saveConfig(config)
    const result = await api.applyQuickEntrySettings()
    await api.rescheduleNotifications()
    setHotkeyWarnings(result)
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus('idle'), 2000)
  }, [])

  const scheduleSave = useCallback((config: AppConfig) => {
    pendingConfigRef.current = config
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      if (pendingConfigRef.current) flushSave(pendingConfigRef.current)
    }, 500)
  }, [flushSave])

  const handleQuickEntryChange = useCallback((partial: Partial<AppConfig>) => {
    setFullConfig((prev) => {
      if (!prev) return null
      const next = { ...prev, ...partial }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleLogout = async () => {
    await api.logout()
    await api.saveConfig({
      vikunja_url: '',
      api_token: '',
      inbox_project_id: 0,
      auth_method: 'api_token',
      theme,
    })
    window.location.reload()
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--bg-secondary)]">
      <div className="px-6 pb-2 pt-6">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Settings</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[var(--border-color)] px-6">
        {([
          { key: 'general' as const, label: 'General' },
          { key: 'notifications' as const, label: 'Notifications' },
          { key: 'shortcuts' as const, label: 'Keyboard Shortcuts' },
        ]).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-3 py-2 text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'border-b-2 border-accent-blue text-accent-blue'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'shortcuts' ? (
        <KeyboardShortcuts />
      ) : activeTab === 'notifications' ? (
        fullConfig && (
          <NotificationSettings
            config={fullConfig}
            onChange={handleQuickEntryChange}
          />
        )
      ) : (
      <div className="mx-6 max-w-lg space-y-6 pb-8 pt-4">
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Connection</h2>

          {authMethod === 'oidc' ? (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">Vikunja URL</label>
                <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                  {url}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-accent-green" />
                <span className="text-xs text-accent-green">Signed in via SSO</span>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="rounded-md border border-accent-red/30 px-4 py-2 text-sm font-medium text-accent-red transition-colors hover:bg-accent-red/10"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">Vikunja URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://vikunja.example.com"
                  className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-accent-blue focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 flex items-center text-xs text-[var(--text-secondary)]">
                  API Token
                  <TokenPermissionsInfo />
                </label>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Enter your API token"
                    className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 pr-16 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-accent-blue focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    {showToken ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={handleTestConnection}
                disabled={!url || !token || testStatus === 'testing'}
                className={cn(
                  'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                  'bg-accent-blue text-white hover:bg-accent-blue/90',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
              </button>

              {testStatus === 'success' && (
                <p className="text-xs text-accent-green">Connected successfully</p>
              )}
              {testStatus === 'error' && (
                <p className="text-xs text-accent-red">{testError || 'Connection failed'}</p>
              )}

              <div className="border-t border-[var(--border-color)] pt-3">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-md border border-accent-red/30 px-4 py-2 text-sm font-medium text-accent-red transition-colors hover:bg-accent-red/10"
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Preferences</h2>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">Inbox Project</label>
              <select
                value={inboxProjectId}
                onChange={(e) => { const id = Number(e.target.value); setInboxProjectId(id); handleQuickEntryChange({ inbox_project_id: id }) }}
                className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none"
              >
                <option value={0}>Select a project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-xs text-[var(--text-secondary)]">Theme</label>
              <div className="flex gap-3">
                {(['light', 'dark', 'system'] as ThemeOption[]).map((opt) => (
                  <label
                    key={opt}
                    className={cn(
                      'flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                      theme === opt
                        ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                        : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]'
                    )}
                  >
                    <input
                      type="radio"
                      name="theme"
                      value={opt}
                      checked={theme === opt}
                      onChange={() => { setTheme(opt); applyTheme(opt); handleQuickEntryChange({ theme: opt }) }}
                      className="sr-only"
                    />
                    {opt.charAt(0).toUpperCase() + opt.slice(1)}
                  </label>
                ))}
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={fullConfig?.exclamation_today !== false}
                onChange={(e) => handleQuickEntryChange({ exclamation_today: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
              />
              <span className="text-sm text-[var(--text-primary)]">
                <code className="rounded bg-[var(--bg-secondary)] px-1 py-0.5 text-xs">!</code> in task title schedules for today
              </span>
            </label>
          </div>
        </div>

        {fullConfig && (
          <QuickEntrySettings
            config={fullConfig}
            projects={projects}
            onChange={handleQuickEntryChange}
            hotkeyWarnings={hotkeyWarnings}
          />
        )}

        {fullConfig && (
          <ObsidianSettings
            config={fullConfig}
            onChange={handleQuickEntryChange}
            disabled={!fullConfig.quick_entry_enabled}
          />
        )}

        {fullConfig && (
          <BrowserSettings
            config={fullConfig}
            onChange={handleQuickEntryChange}
            disabled={!fullConfig.quick_entry_enabled}
          />
        )}

        {saveStatus === 'saving' && (
          <p className="text-xs text-[var(--text-secondary)]">Saving...</p>
        )}
        {saveStatus === 'saved' && (
          <p className="text-xs text-accent-green">Settings saved</p>
        )}
      </div>
      )}
    </div>
  )
}
