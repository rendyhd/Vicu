import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { api, type VikunjaUser } from '@/lib/api'
import { APP_CONFIG_QUERY_KEY } from '@/hooks/use-app-config'
import { cn } from '@/lib/cn'
import { applyTheme } from '@/lib/theme'
import { TokenPermissionsInfo } from '@/views/SetupView'
import { QuickEntrySettings } from '@/components/settings/QuickEntrySettings'
import { ObsidianSettings } from '@/components/settings/ObsidianSettings'
import { BrowserSettings } from '@/components/settings/BrowserSettings'
import { SecretStorageNotice } from '@/components/settings/SecretStorageNotice'
import { KeyboardShortcuts } from '@/components/settings/KeyboardShortcuts'
import { NotificationSettings } from '@/components/settings/NotificationSettings'
import { CompletionSoundSettings } from '@/components/settings/CompletionSoundSettings'
import { ReviewSettingsPanel } from '@/components/review/ReviewSettingsPanel'
import { RoutinesSettingsPanel } from '@/components/routines/RoutinesSettingsPanel'
import { ProjectSettings } from '@/components/settings/ProjectSettings'
import { useProjects } from '@/hooks/use-projects'
import { toast } from '@/stores/toast-store'
import { connectionAfterTest } from '@/lib/connection-settings'
import { confirmDelete } from '@/lib/confirm-bridge'
import { checkUnsyncedWork, signOutWarning } from '@/lib/sign-out-check'
import type { AppConfig, Project } from '@/lib/vikunja-types'

import type { ThemeOption } from '@/lib/theme'

type SettingsTab = 'general' | 'projects' | 'integrations' | 'notifications' | 'shortcuts'

export function SettingsView() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [inboxProjectId, setInboxProjectId] = useState(0)
  const [theme, setTheme] = useState<ThemeOption>('system')
  const [authMethod, setAuthMethod] = useState<'api_token' | 'oidc' | 'password'>('api_token')
  const [currentUser, setCurrentUser] = useState<VikunjaUser | null>(null)
  // Set while sign-out gives queued changes and custom lists a last chance to reach the server.
  const [signingOut, setSigningOut] = useState(false)

  const [projects, setProjects] = useState<Project[]>([])
  const { data: liveProjectData } = useProjects()
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testError, setTestError] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  // Linux can only autostart when the app knows its own executable (not in a development run).
  const [launchOnStartupSupported, setLaunchOnStartupSupported] = useState(true)
  const [hotkeyWarnings, setHotkeyWarnings] = useState<{ entry: boolean; viewer: boolean; waylandLimited: boolean } | undefined>(undefined)

  // Config as loaded, plus the edits made here. Used to render the controls only.
  const [fullConfig, setFullConfig] = useState<AppConfig | null>(null)
  const configLoadedRef = useRef(false)

  // Auto-save with debounce. Only the keys edited since the last save are sent: main
  // merges them into the current config, so fields it changes on its own (window
  // bounds, sidebar width, popup positions...) are never reverted by this snapshot.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPatchRef = useRef<Partial<AppConfig>>({})

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return

      event.preventDefault()
      if (router.history.canGoBack()) {
        router.history.back()
      } else {
        navigate({ to: '/inbox', replace: true })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate, router])

  useEffect(() => {
    api.getConfig().then((config) => {
      if (config) {
        configLoadedRef.current = true
        setFullConfig(config)
        setUrl(config.vikunja_url || '')
        setToken(config.api_token || '')
        setInboxProjectId(config.inbox_project_id || 0)
        setTheme(config.theme || 'system')
        setAuthMethod(config.auth_method || 'api_token')

        if (config.auth_method === 'password' || config.auth_method === 'oidc') {
          api.getUser().then((user) => {
            if (user) setCurrentUser(user)
          })
        }
      }
    })
    // Pull current global-shortcut registration state so the banner shows on
    // cold start, not only after the user edits a hotkey.
    api.getGlobalShortcutStatus().then(setHotkeyWarnings).catch(() => {})
    api.getLaunchOnStartupSupport().then((result) => setLaunchOnStartupSupported(result.supported)).catch(() => {})
  }, [])

  useEffect(() => {
    if (url && (token || authMethod === 'oidc' || authMethod === 'password')) {
      api.fetchProjects().then((res) => {
        if (res.success) setProjects(res.data)
      })
    }
  }, [url, token, authMethod])

  useEffect(() => {
    if (liveProjectData) setProjects(liveProjectData.flat)
  }, [liveProjectData])

  const handleTestConnection = async () => {
    setTestStatus('testing')
    setTestError('')
    const result = await api.testConnection(url, token)
    if (result.success) {
      setTestStatus('success')
      setProjects(result.data)
      // Save the connection after a successful test. A new URL or token can be another account,
      // so it goes through saveConnectionConfig (which also resets what belonged to the previous
      // account), not through the preference patch.
      const connection = connectionAfterTest(url, token, authMethod)
      try {
        await api.saveConnectionConfig(connection)
        setFullConfig((prev) => (prev ? { ...prev, ...connection } : prev))
        queryClient.invalidateQueries({ queryKey: APP_CONFIG_QUERY_KEY })
      } catch (err) {
        console.error('Failed to save the connection', err)
        setTestStatus('error')
        setTestError('Connected, but the connection settings could not be saved. Try again.')
      }
    } else {
      setTestStatus('error')
      setTestError(result.error)
    }
  }

  const flushSave = useCallback(async () => {
    const patch = pendingPatchRef.current
    pendingPatchRef.current = {}
    if (Object.keys(patch).length === 0) return
    setSaveStatus('saving')
    try {
      await api.saveConfigPatch(patch)
      const result = await api.applyQuickEntrySettings()
      await api.rescheduleNotifications()
      queryClient.invalidateQueries({ queryKey: APP_CONFIG_QUERY_KEY })
      setHotkeyWarnings(result)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      console.error('Failed to save settings', err)
      // The file could not be written (main keeps what is on disk as it was). Keep the changes
      // so the next one sends them again, and say so instead of showing "saved".
      pendingPatchRef.current = { ...patch, ...pendingPatchRef.current }
      setSaveStatus('error')
      const reason = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : ''
      toast.error(reason ? `Could not save settings: ${reason}` : 'Could not save settings')
    }
  }, [queryClient])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void flushSave()
    }, 500)
  }, [flushSave])

  const handleQuickEntryChange = useCallback((partial: Partial<AppConfig>) => {
    if (!configLoadedRef.current) return
    setFullConfig((prev) => (prev ? { ...prev, ...partial } : prev))
    pendingPatchRef.current = { ...pendingPatchRef.current, ...partial }
    scheduleSave()
  }, [scheduleSave])

  const handleLogout = async () => {
    if (signingOut) return
    setSigningOut(true)
    let warning: string | null
    try {
      warning = signOutWarning(await checkUnsyncedWork({
        syncCustomLists: api.syncCustomLists,
        replayNow: api.offlineQueue.replayNow,
        snapshot: api.offlineQueue.snapshot,
        getConfig: api.getConfig,
      }))
    } finally {
      setSigningOut(false)
    }
    if (warning && !(await confirmDelete(warning, { force: true, confirmLabel: 'Sign Out' }))) return
    await api.logout()
    // Main keeps app preferences (theme, hotkeys, window bounds, notifications, etc.)
    // and clears the connection and account-specific data (project IDs, custom lists, etc.)
    await api.saveConnectionConfig({
      vikunja_url: '',
      api_token: '',
      auth_method: 'api_token',
      inbox_project_id: 0,
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
          { key: 'projects' as const, label: 'Projects' },
          { key: 'integrations' as const, label: 'Quick Entry / View' },
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
      ) : activeTab === 'projects' ? (
        <ProjectSettings />
      ) : activeTab === 'notifications' ? (
        fullConfig && (
          <NotificationSettings
            config={fullConfig}
            onChange={handleQuickEntryChange}
          />
        )
      ) : activeTab === 'general' ? (
      <div className="mx-6 max-w-lg space-y-6 pb-8 pt-4">
        <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Connection</h2>

          {authMethod === 'oidc' || authMethod === 'password' ? (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">Vikunja URL</label>
                <div className="rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                  {url}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-status-done" />
                <span className="text-xs text-status-done">
                  {authMethod === 'oidc'
                    ? 'Signed in via SSO'
                    : currentUser
                      ? `Signed in as ${currentUser.name || currentUser.username}`
                      : 'Signed in'}
                </span>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                disabled={signingOut}
                className="rounded-control border border-danger/30 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:cursor-wait disabled:opacity-60"
              >
                {signingOut ? 'Syncing...' : 'Sign Out'}
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
                  className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
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
                    className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 pr-16 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-control px-2 py-0.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
                  'rounded-control px-4 py-2 text-sm font-medium transition-colors',
                  'bg-accent-fill text-on-accent hover:bg-accent-fill/90',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
              </button>

              {testStatus === 'success' && (
                <p className="text-xs text-status-done">Connected successfully</p>
              )}
              {testStatus === 'error' && (
                <p className="text-xs text-danger">{testError || 'Connection failed'}</p>
              )}

              <div className="border-t border-[var(--border-color)] pt-3">
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={signingOut}
                  className="rounded-control border border-danger/30 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:cursor-wait disabled:opacity-60"
                >
                  {signingOut ? 'Syncing...' : 'Disconnect'}
                </button>
              </div>
            </div>
          )}
          <SecretStorageNotice />
        </div>

        <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Preferences</h2>

          <div className="space-y-3">
            {launchOnStartupSupported && (
              <>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={fullConfig?.launch_on_startup ?? false}
                    onChange={(e) => handleQuickEntryChange({ launch_on_startup: e.target.checked })}
                    className="h-4 w-4 rounded-control border-[var(--border-color)] accent-accent-blue"
                  />
                  <span className="text-sm text-[var(--text-primary)]">
                    Launch on startup
                  </span>
                  <span className="text-xs text-[var(--text-secondary)]">(advised for Quick Entry / View)</span>
                </label>

                {fullConfig?.launch_on_startup === true && (
                  <label className="ml-6 flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={fullConfig?.start_hidden ?? false}
                      onChange={(e) => handleQuickEntryChange({ start_hidden: e.target.checked })}
                      className="h-4 w-4 rounded-control border-[var(--border-color)] accent-accent-blue"
                    />
                    <span className="text-sm text-[var(--text-primary)]">
                      Start hidden
                    </span>
                    <span className="text-xs text-[var(--text-secondary)]">(no window at login; needs the tray icon from Quick Entry / View)</span>
                  </label>
                )}
              </>
            )}

            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={fullConfig?.confirm_before_delete !== false}
                onChange={(e) => handleQuickEntryChange({ confirm_before_delete: e.target.checked })}
                className="h-4 w-4 rounded-control border-[var(--border-color)] accent-accent-blue"
              />
              <span className="text-sm text-[var(--text-primary)]">
                Confirm before deleting
              </span>
            </label>

            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-sm text-[var(--text-primary)]">Subtasks in task lists</span>
                <span className="block text-xs text-[var(--text-secondary)]">
                  Keep them in task details, or expand them below the parent.
                </span>
              </span>
              <select
                value={fullConfig?.subtask_display ?? 'inside_task'}
                onChange={(e) => handleQuickEntryChange({
                  subtask_display: e.target.value as 'inside_task' | 'expandable',
                })}
                className="rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
              >
                <option value="inside_task">Inside task</option>
                <option value="expandable">Expandable</option>
              </select>
            </label>

            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={fullConfig?.show_today_overdue_badge === true}
                onChange={(e) => handleQuickEntryChange({ show_today_overdue_badge: e.target.checked })}
                className="h-4 w-4 rounded-control border-[var(--border-color)] accent-accent-blue"
              />
              <span className="text-sm text-[var(--text-primary)]">
                Show today &amp; overdue count on app icon
              </span>
            </label>

            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">Inbox Project</label>
              <select
                value={inboxProjectId}
                onChange={(e) => { const id = Number(e.target.value); setInboxProjectId(id); handleQuickEntryChange({ inbox_project_id: id }) }}
                className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
              >
                <option value={0}>Select a project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
              {inboxProjectId !== 0 && !projects.some((project) => project.id === inboxProjectId) && (
                <p className="mt-1 text-xs text-danger">
                  The configured Inbox project is archived or unavailable. Select an active project.
                </p>
              )}
            </div>

            <div>
              <label className="mb-2 block text-xs text-[var(--text-secondary)]">Theme</label>
              <div className="flex gap-3">
                {(['light', 'dark', 'system'] as ThemeOption[]).map((opt) => (
                  <label
                    key={opt}
                    className={cn(
                      'flex cursor-pointer items-center gap-1.5 rounded-control border px-3 py-1.5 text-xs font-medium transition-colors',
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

            <div>
              <label className="mb-2 block text-xs text-[var(--text-secondary)]">What does urgent mean?</label>
              <div className="flex gap-3">
                {([
                  { value: 'today' as const, label: 'Schedule for Today' },
                  { value: 'important' as const, label: 'Mark Important' },
                ]).map((opt) => {
                  const current = fullConfig?.urgency_mode ?? 'today'
                  return (
                    <label
                      key={opt.value}
                      className={cn(
                        'flex cursor-pointer items-center gap-1.5 rounded-control border px-3 py-1.5 text-xs font-medium transition-colors',
                        current === opt.value
                          ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                          : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]'
                      )}
                    >
                      <input
                        type="radio"
                        name="urgency_mode"
                        value={opt.value}
                        checked={current === opt.value}
                        onChange={() => handleQuickEntryChange({ urgency_mode: opt.value })}
                        className="sr-only"
                      />
                      {opt.label}
                    </label>
                  )
                })}
              </div>
              <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                Sets what the top action in a task&rsquo;s right-click menu does.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-xs text-[var(--text-secondary)]">Clock</label>
              <div className="flex gap-3" role="radiogroup" aria-label="Clock">
                {([
                  { value: 'system' as const, label: 'System' },
                  { value: '12h' as const, label: '12-hour' },
                  { value: '24h' as const, label: '24-hour' },
                ]).map((opt) => {
                  const current = fullConfig?.clock_format ?? 'system'
                  return (
                    <label
                      key={opt.value}
                      className={cn(
                        'flex cursor-pointer items-center gap-1.5 rounded-control border px-3 py-1.5 text-xs font-medium transition-colors',
                        current === opt.value
                          ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                          : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]'
                      )}
                    >
                      <input
                        type="radio"
                        name="clock_format"
                        value={opt.value}
                        checked={current === opt.value}
                        onChange={() => handleQuickEntryChange({ clock_format: opt.value })}
                        className="sr-only"
                      />
                      {opt.label}
                    </label>
                  )
                })}
              </div>
              <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                System follows your region. Pick 12-hour or 24-hour if your system uses a custom time format. Applies to every Vicu window.
              </p>
            </div>

          </div>
        </div>

        {fullConfig && (
          <CompletionSoundSettings
            config={fullConfig}
            onChange={handleQuickEntryChange}
          />
        )}

        {fullConfig && (
          <ReviewSettingsPanel
            config={fullConfig}
            onChange={handleQuickEntryChange}
          />
        )}

        {fullConfig && (
          <RoutinesSettingsPanel
            config={fullConfig}
            onChange={handleQuickEntryChange}
          />
        )}

        {/* Task Parser */}
        <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Task Parser</h2>

          <div className="space-y-3">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={fullConfig?.nlp_enabled !== false}
                onChange={(e) => handleQuickEntryChange({ nlp_enabled: e.target.checked })}
                className="h-4 w-4 rounded-control border-[var(--border-color)] accent-accent-blue"
              />
              <div>
                <span className="text-sm text-[var(--text-primary)]">
                  Parse task metadata from text
                </span>
                <p className="text-xs text-[var(--text-secondary)]">
                  Extract labels, projects, priority, dates, and recurrence from your input
                </p>
              </div>
            </label>

            {fullConfig?.nlp_enabled !== false && (
              <>
                <div>
                  <div className="mb-2 block text-xs text-[var(--text-secondary)]">
                    Syntax Mode
                  </div>
                  <div role="radiogroup" className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={(fullConfig?.nlp_syntax_mode || 'todoist') === 'todoist'}
                      onClick={() => handleQuickEntryChange({ nlp_syntax_mode: 'todoist' })}
                      className={cn(
                        'cursor-pointer rounded-card border p-3 text-left transition-colors',
                        (fullConfig?.nlp_syntax_mode || 'todoist') === 'todoist'
                          ? 'border-accent-blue bg-accent-blue/5'
                          : 'border-[var(--border-color)]'
                      )}
                    >
                      <div className="text-sm font-medium text-[var(--text-primary)]">Todoist</div>
                      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                        Familiar Todoist-style prefixes
                      </p>
                      <p className="mt-1.5 font-mono text-xs">
                        <code className="text-blue-500">#project</code>{' '}
                        <code className="text-orange-500">@label</code>{' '}
                        <code className="text-danger">p1-p4</code>
                      </p>
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={fullConfig?.nlp_syntax_mode === 'vikunja'}
                      onClick={() => handleQuickEntryChange({ nlp_syntax_mode: 'vikunja' })}
                      className={cn(
                        'cursor-pointer rounded-card border p-3 text-left transition-colors',
                        fullConfig?.nlp_syntax_mode === 'vikunja'
                          ? 'border-accent-blue bg-accent-blue/5'
                          : 'border-[var(--border-color)]'
                      )}
                    >
                      <div className="text-sm font-medium text-[var(--text-primary)]">Vikunja</div>
                      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                        Native Vikunja-style prefixes
                      </p>
                      <p className="mt-1.5 font-mono text-xs">
                        <code className="text-blue-500">+project</code>{' '}
                        <code className="text-orange-500">*label</code>{' '}
                        <code className="text-danger">!1-!4</code>
                      </p>
                    </button>
                  </div>
                </div>

                {/* ! → today shortcut */}
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={fullConfig?.exclamation_today !== false}
                    onChange={(e) => handleQuickEntryChange({ exclamation_today: e.target.checked })}
                    className="h-4 w-4 rounded-control border-[var(--border-color)] accent-accent-blue"
                  />
                  <div>
                    <span className="text-sm text-[var(--text-primary)]">
                      <code className="rounded-control bg-[var(--bg-secondary)] px-1 py-0.5 text-xs font-mono text-green-600">!</code> in task title sets due date to today
                    </span>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Add ! before or after a task title to set it due today (e.g. "buy groceries !" or "! buy groceries")
                    </p>
                  </div>
                </label>
              </>
            )}
          </div>
        </div>

        {saveStatus === 'saving' && (
          <p className="text-xs text-[var(--text-secondary)]">Saving...</p>
        )}
        {saveStatus === 'saved' && (
          <p className="text-xs text-status-done">Settings saved</p>
        )}
        {saveStatus === 'error' && (
          <p className="text-xs text-danger">Settings could not be saved. Your changes are kept and are saved again with the next change.</p>
        )}
      </div>
      ) : activeTab === 'integrations' ? (
      <div className="mx-6 max-w-lg space-y-6 pb-8 pt-4">
        {fullConfig && (
          <QuickEntrySettings
            config={fullConfig}
            projects={projects}
            onChange={handleQuickEntryChange}
            hotkeyWarnings={hotkeyWarnings}
          />
        )}

        {fullConfig && (
          <BrowserSettings
            config={fullConfig}
            onChange={handleQuickEntryChange}
            disabled={!fullConfig.quick_entry_enabled}
          />
        )}

        {/* Obsidian integration is unavailable on Linux (Wayland blocks the
            foreground-process detection it relies on) — hide the section
            entirely so users aren't offered a dead setting. */}
        {fullConfig && window.api.platform !== 'linux' && (
          <ObsidianSettings
            config={fullConfig}
            onChange={handleQuickEntryChange}
            disabled={!fullConfig.quick_entry_enabled}
          />
        )}

        {saveStatus === 'saving' && (
          <p className="text-xs text-[var(--text-secondary)]">Saving...</p>
        )}
        {saveStatus === 'saved' && (
          <p className="text-xs text-status-done">Settings saved</p>
        )}
        {saveStatus === 'error' && (
          <p className="text-xs text-danger">Settings could not be saved. Your changes are kept and are saved again with the next change.</p>
        )}
      </div>
      ) : null}
    </div>
  )
}
