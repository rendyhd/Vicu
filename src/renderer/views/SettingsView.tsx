import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { api, type VikunjaUser } from '@/lib/api'
import { APP_CONFIG_QUERY_KEY } from '@/hooks/use-app-config'
import { cn } from '@/lib/cn'
import { Checkbox } from '@/components/shared/Checkbox'
import { Button } from '@/components/shared/Button'
import { PageHeader } from '@/components/shared/PageHeader'
import { ReadingScroll } from '@/components/layout/ReadingScroll'
import { applyTheme } from '@/lib/theme'
import { TokenPermissionsInfo } from '@/views/SetupView'
import { QuickEntrySettings } from '@/components/settings/QuickEntrySettings'
import { ObsidianSettings } from '@/components/settings/ObsidianSettings'
import { BrowserSettings } from '@/components/settings/BrowserSettings'
import { SecretStorageNotice } from '@/components/settings/SecretStorageNotice'
import { KeyboardShortcuts } from '@/components/settings/KeyboardShortcuts'
import { VoiceSettings } from '@/components/settings/VoiceSettings'
import { AssistantSettings } from '@/components/settings/AssistantSettings'
import { NotificationSettings } from '@/components/settings/NotificationSettings'
import { CompletionSoundSettings } from '@/components/settings/CompletionSoundSettings'
import { SidebarSettings } from '@/components/settings/SidebarSettings'
import { PlannerSettings } from '@/components/settings/PlannerSettings'
import { WeekStartSetting } from '@/components/settings/WeekStartSetting'
import { CloseActionSetting } from '@/components/settings/CloseActionSetting'
import { LanguageSetting } from '@/components/settings/LanguageSetting'
import { RoutinesSettingsPanel } from '@/components/routines/RoutinesSettingsPanel'
import { ProjectSettings } from '@/components/settings/ProjectSettings'
import { useProjects } from '@/hooks/use-projects'
import { toast } from '@/stores/toast-store'
import { connectionAfterTest } from '@/lib/connection-settings'
import { confirmDelete } from '@/lib/confirm-bridge'
import { checkUnsyncedWork, signOutWarning } from '@/lib/sign-out-check'
import { closeAction, type AppConfig, type Project } from '@/lib/vikunja-types'

import type { ThemeOption } from '@/lib/theme'
import { ProSettings } from '@/components/settings/ProSettings'
import { SettingsMenu, SETTINGS_TAB_LABELS } from '@/components/settings/SettingsMenu'
import { currentSectionIndex, SETTINGS_MENU_WIDTH } from '@/lib/settings-menu'
import { useSettingsNavStore } from '@/stores/settings-nav-store'
import type { TranslationKey } from '../../shared/i18n'

/** Every tab's content sits in the same column, left-aligned with the page title. */
const SETTINGS_COLUMN = 'mx-6 max-w-[640px] space-y-6 pb-8 pt-4'

const THEME_OPTIONS: { value: ThemeOption; label: TranslationKey }[] = [
  { value: 'light', label: 'settings.appearance.themeLight' },
  { value: 'dark', label: 'settings.appearance.themeDark' },
  { value: 'system', label: 'settings.appearance.themeSystem' },
]

export function SettingsView() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const router = useRouter()
  const activeTab = useSettingsNavStore((s) => s.tab)
  const setActiveTab = useSettingsNavStore((s) => s.setTab)
  const menuInSidebar = useSettingsNavStore((s) => s.inSidebar)
  const { section } = useSearch({ from: '/settings' })
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  // The token itself never reaches this page: only whether one is saved, so Test Connection can use it.
  const [hasSavedToken, setHasSavedToken] = useState(false)
  const [showToken, setShowToken] = useState(false)
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

  // Manage in the Plan gear: the calendars of the Plan settings, once they are drawn.
  useEffect(() => {
    if (section === 'pro') setActiveTab('pro')
    if (section === 'assistant') setActiveTab('assistant')
  }, [section])
  useEffect(() => {
    if (section !== 'calendars' || !fullConfig) return
    setActiveTab('pro')
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>('[data-calendar-feeds]')
      // Only the settings column scrolls: scrollIntoView would also shift the window's own layout.
      let scroller = target?.parentElement ?? null
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
        scroller = scroller.parentElement
      }
      if (target && scroller) scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16
    })
    return () => cancelAnimationFrame(frame)
  }, [section, fullConfig])

  // The menu lists the open tab's section headings (h2, not those of a dialog), marks the one being
  // read and scrolls to one on a click. Read from the page, so a section that comes and goes (Pro on
  // or off, a setting that needs another) is followed without a list to keep in step.
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const scroller = scrollRef.current
    const content = contentRef.current
    if (!scroller || !content) return
    const { setSections, setCurrent, setJumpTo } = useSettingsNavStore.getState()
    let headings: HTMLElement[] = []
    const follow = (): void => {
      const top = scroller.getBoundingClientRect().top
      const atEnd = scroller.scrollTop > 0 && scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 2
      setCurrent(currentSectionIndex(headings.map((h) => h.getBoundingClientRect().top - top), atEnd))
    }
    const collect = (): void => {
      headings = Array.from(content.querySelectorAll<HTMLElement>('h2')).filter((h) => !h.closest('dialog, [popover]'))
      setSections(headings.map((h) => h.textContent?.trim() || t('settings.sectionFallback')))
      follow()
    }
    let frame = 0
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; collect() })
    }
    collect()
    const observer = new MutationObserver(schedule)
    observer.observe(content, { childList: true, subtree: true, characterData: true })
    scroller.addEventListener('scroll', follow, { passive: true })
    setJumpTo((index) => {
      const heading = headings[index]
      if (!heading) return
      // Only the settings scroll: scrollIntoView would also shift the window's own layout.
      scroller.scrollTop += heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      scroller.removeEventListener('scroll', follow)
      setJumpTo(null)
      setSections([])
      setCurrent(-1)
    }
  }, [activeTab])
  // A tab opens at its top.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [activeTab])
  const configLoadedRef = useRef(false)

  // Auto-save with debounce. Only the keys edited since the last save are sent: main
  // merges them into the current config, so fields it changes on its own (window
  // bounds, sidebar width, popup positions...) are never reverted by this snapshot.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPatchRef = useRef<Partial<AppConfig>>({})

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      // A modal dialog (Add a calendar, a confirmation) closes on Escape itself, also when focus
      // fell to the page behind it (a button disabled while it works).
      if (document.querySelector('dialog[open]')) return

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
        setTheme(config.theme || 'system')
        setAuthMethod(config.auth_method || 'api_token')
        if (!config.auth_method || config.auth_method === 'api_token') {
          api.checkAuth().then((auth) => setHasSavedToken(auth.status === 'authenticated')).catch(() => {})
        }

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
      // Nothing was typed: the saved token passed, so the connection is already what is saved.
      if (!token) return
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
        setTestError(t('settings.connection.notSaved'))
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
      toast.error(reason ? t('settings.save.failedWithReason', { reason }) : t('settings.save.failed'))
    }
  }, [queryClient, t])

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
        syncSyncedPrefs: api.syncSyncedPrefs,
        replayNow: api.offlineQueue.replayNow,
        snapshot: api.offlineQueue.snapshot,
        getConfig: api.getConfig,
      }))
    } finally {
      setSigningOut(false)
    }
    if (warning && !(await confirmDelete(warning, { force: true, confirmLabel: t('settings.connection.signOut') }))) return
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
    <div className="flex min-h-0 flex-1">
      {/* The menu: a column here, or the app sidebar's place when the page is narrow (AppShell). */}
      {!menuInSidebar && (
        <div className="shrink-0 border-r border-[var(--border-color)]" style={{ width: SETTINGS_MENU_WIDTH }}>
          <SettingsMenu variant="column" />
        </div>
      )}
    <ReadingScroll ref={scrollRef} className="bg-[var(--bg-primary)]" columnClassName="mx-0 flex flex-col">
      <PageHeader title={t(SETTINGS_TAB_LABELS[activeTab])} inScroll />

      <div ref={contentRef}>
      {/* One column width for every tab (SETTINGS_COLUMN). */}
      {activeTab === 'shortcuts' ? (
        <div className={SETTINGS_COLUMN}>
          {fullConfig && <VoiceSettings config={fullConfig} onChange={handleQuickEntryChange} />}
          <KeyboardShortcuts />
        </div>
      ) : activeTab === 'projects' ? (
        <div className={SETTINGS_COLUMN}>
          {fullConfig && <ProjectSettings config={fullConfig} onChange={handleQuickEntryChange} />}
        </div>
      ) : activeTab === 'pro' ? (
        <div className={SETTINGS_COLUMN}>
          <ProSettings />
          {/* Plan lives with Pro's tools, but works whether Pro is on or off. */}
          {fullConfig && !fullConfig.standalone_mode && <PlannerSettings config={fullConfig} onChange={handleQuickEntryChange} />}
        </div>
      ) : activeTab === 'assistant' ? (
        <div className={SETTINGS_COLUMN}>
          <AssistantSettings />
        </div>
      ) : activeTab === 'notifications' ? (
        <div className={SETTINGS_COLUMN}>
          {fullConfig && (
            <NotificationSettings
              config={fullConfig}
              onChange={handleQuickEntryChange}
            />
          )}
        </div>
      ) : activeTab === 'general' ? (
      <div className={SETTINGS_COLUMN}>
        <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">{t('settings.connection.title')}</h2>

          {authMethod === 'oidc' || authMethod === 'password' ? (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">{t('settings.connection.url')}</label>
                <div className="rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                  {url}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-status-done" />
                <span className="text-xs text-status-done">
                  {authMethod === 'oidc'
                    ? t('settings.connection.signedInSso')
                    : currentUser
                      ? t('settings.connection.signedInAs', { name: currentUser.name || currentUser.username })
                      : t('settings.connection.signedIn')}
                </span>
              </div>

              <Button variant="secondary" danger onClick={handleLogout} disabled={signingOut}>
                {signingOut ? t('settings.connection.syncing') : t('settings.connection.signOut')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">{t('settings.connection.url')}</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  // i18n-ignore: an address example, the same in every language
                  placeholder="https://vikunja.example.com"
                  className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
                />
              </div>

              <div>
                <label className="mb-1 flex items-center text-xs text-[var(--text-secondary)]">
                  {t('settings.connection.apiToken')}
                  <TokenPermissionsInfo />
                </label>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={t('settings.connection.tokenPlaceholder')}
                    className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 pr-16 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2 top-1/2 inline-flex min-h-6 -translate-y-1/2 items-center rounded-control px-2 py-0.5 text-meta text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    {showToken ? t('settings.connection.hideToken') : t('settings.connection.showToken')}
                  </button>
                </div>
                {hasSavedToken && (
                  <p className="mt-1 text-meta text-[var(--text-secondary)]">
                    {t('settings.connection.savedToken')}
                  </p>
                )}
              </div>

              <Button
                variant="primary"
                onClick={handleTestConnection}
                disabled={!url || (!token && !hasSavedToken) || testStatus === 'testing'}
              >
                {testStatus === 'testing' ? t('settings.connection.testing') : t('settings.connection.test')}
              </Button>

              {testStatus === 'success' && (
                <p className="text-xs text-status-done">{t('settings.connection.success')}</p>
              )}
              {testStatus === 'error' && (
                <p className="text-xs text-danger">{testError || t('settings.connection.failed')}</p>
              )}

              <div className="border-t border-[var(--border-color)] pt-3">
                <Button variant="secondary" danger onClick={handleLogout} disabled={signingOut}>
                  {signingOut ? t('settings.connection.syncing') : t('settings.connection.disconnect')}
                </Button>
              </div>
            </div>
          )}
          <SecretStorageNotice />
        </div>

        <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">{t('settings.appearance.title')}</h2>

          <div className="space-y-3">
            <div>
              <label className="mb-2 block text-xs text-[var(--text-secondary)]">{t('settings.appearance.theme')}</label>
              <div className="flex gap-3">
                {THEME_OPTIONS.map(({ value: opt, label }) => (
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
                    {t(label)}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs text-[var(--text-secondary)]">{t('settings.appearance.clock')}</label>
              <div className="flex gap-3" role="radiogroup" aria-label={t('settings.appearance.clock')}>
                {([
                  { value: 'system' as const, label: t('settings.appearance.clockSystem') },
                  { value: '12h' as const, label: t('settings.appearance.clock12') },
                  { value: '24h' as const, label: t('settings.appearance.clock24') },
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
                {t('settings.appearance.clockNote')}
              </p>
            </div>

            <div>
              <label className="mb-2 block text-xs text-[var(--text-secondary)]">{t('settings.appearance.rows')}</label>
              <div className="flex gap-3" role="radiogroup" aria-label={t('settings.appearance.rows')}>
                {([
                  { value: 'compact' as const, label: t('settings.appearance.rowsCompact') },
                  { value: 'comfortable' as const, label: t('settings.appearance.rowsComfortable') },
                ]).map((opt) => {
                  const current = fullConfig?.row_density ?? 'compact'
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
                        name="row_density"
                        value={opt.value}
                        checked={current === opt.value}
                        onChange={() => handleQuickEntryChange({ row_density: opt.value })}
                        className="sr-only"
                      />
                      {opt.label}
                    </label>
                  )
                })}
              </div>
              <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                {t('settings.appearance.rowsNote')}
              </p>
            </div>

          </div>
        </div>

        <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">{t('settings.preferences.title')}</h2>

          <div className="space-y-3">
            {launchOnStartupSupported && (
              <>
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={fullConfig?.launch_on_startup ?? false}
                    onChange={(e) => handleQuickEntryChange({ launch_on_startup: e.target.checked })}
                  />
                  <span className="text-sm text-[var(--text-primary)]">
                    {t('settings.preferences.launchOnStartup')}
                  </span>
                  <span className="text-xs text-[var(--text-secondary)]">{t('settings.preferences.launchOnStartupNote')}</span>
                </label>

                {fullConfig?.launch_on_startup === true && (
                  <label className="ml-6 flex cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={fullConfig?.start_hidden ?? false}
                      onChange={(e) => handleQuickEntryChange({ start_hidden: e.target.checked })}
                    />
                    <span className="text-sm text-[var(--text-primary)]">
                      {t('settings.preferences.startHidden')}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)]">
                      {window.api.platform === 'darwin'
                        ? t('settings.preferences.startHiddenMac')
                        : closeAction(fullConfig) === 'minimize'
                          ? t('settings.preferences.startHiddenMinimized')
                          : t('settings.preferences.startHiddenTray')}
                    </span>
                  </label>
                )}
              </>
            )}

            {window.api.platform !== 'darwin' && (
              <CloseActionSetting config={fullConfig} onChange={handleQuickEntryChange} />
            )}

            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={fullConfig?.confirm_before_delete !== false}
                onChange={(e) => handleQuickEntryChange({ confirm_before_delete: e.target.checked })}
              />
              <span className="text-sm text-[var(--text-primary)]">
                {t('settings.preferences.confirmDelete')}
              </span>
            </label>

            <WeekStartSetting />

            <LanguageSetting config={fullConfig} onChange={handleQuickEntryChange} />

            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-sm text-[var(--text-primary)]">{t('settings.preferences.subtasks')}</span>
                <span className="block text-xs text-[var(--text-secondary)]">
                  {t('settings.preferences.subtasksNote')}
                </span>
              </span>
              <select
                value={fullConfig?.subtask_display ?? 'inside_task'}
                onChange={(e) => handleQuickEntryChange({
                  subtask_display: e.target.value as 'inside_task' | 'expandable',
                })}
                className="rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
              >
                <option value="inside_task">{t('settings.preferences.subtasksInside')}</option>
                <option value="expandable">{t('settings.preferences.subtasksExpandable')}</option>
              </select>
            </label>

            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={fullConfig?.show_today_overdue_badge === true}
                onChange={(e) => handleQuickEntryChange({ show_today_overdue_badge: e.target.checked })}
              />
              <span className="text-sm text-[var(--text-primary)]">
                {t('settings.preferences.badge')}
              </span>
            </label>
            {window.api.platform === 'darwin' && fullConfig?.show_today_overdue_badge === true && (
              <p className="ml-6 text-xs text-[var(--text-secondary)]">
                {t('settings.preferences.badgeMacNote')}{' '}
                <button
                  type="button"
                  onClick={() => { void api.openBadgeNotificationSettings() }}
                  className="text-accent-blue hover:underline"
                >
                  {t('settings.preferences.notificationSettings')}
                </button>
              </p>
            )}

            <div>
              <label className="mb-2 block text-xs text-[var(--text-secondary)]">{t('settings.preferences.urgent')}</label>
              <div className="flex gap-3">
                {([
                  { value: 'today' as const, label: t('settings.preferences.urgentToday') },
                  { value: 'important' as const, label: t('settings.preferences.urgentImportant') },
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
                {t('settings.preferences.urgentNote')}
              </p>
            </div>

          </div>
        </div>

        {fullConfig && <SidebarSettings config={fullConfig} onChange={handleQuickEntryChange} />}

        {fullConfig && (
          <CompletionSoundSettings
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
          <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">{t('settings.parser.title')}</h2>

          <div className="space-y-3">
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={fullConfig?.nlp_enabled !== false}
                onChange={(e) => handleQuickEntryChange({ nlp_enabled: e.target.checked })}
              />
              <div>
                <span className="text-sm text-[var(--text-primary)]">
                  {t('settings.parser.parse')}
                </span>
                <p className="text-xs text-[var(--text-secondary)]">
                  {t('settings.parser.parseNote')}
                </p>
              </div>
            </label>

            {fullConfig?.nlp_enabled !== false && (
              <>
                <div>
                  <div className="mb-2 block text-xs text-[var(--text-secondary)]">
                    {t('settings.parser.syntaxMode')}
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
                      {/* i18n-ignore: a product name */}
                      <div className="text-sm font-medium text-[var(--text-primary)]">Todoist</div>
                      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                        {t('settings.parser.todoistNote')}
                      </p>
                      <p className="mt-1.5 font-mono text-xs">
                        {/* i18n-ignore: the quick-add syntax stays English */}
                        <code className="text-blue-500">#project</code>{' '}
                        {/* i18n-ignore: the quick-add syntax stays English */}
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
                      {/* i18n-ignore: a product name */}
                      <div className="text-sm font-medium text-[var(--text-primary)]">Vikunja</div>
                      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                        {t('settings.parser.vikunjaNote')}
                      </p>
                      <p className="mt-1.5 font-mono text-xs">
                        {/* i18n-ignore: the quick-add syntax stays English */}
                        <code className="text-blue-500">+project</code>{' '}
                        {/* i18n-ignore: the quick-add syntax stays English */}
                        <code className="text-orange-500">*label</code>{' '}
                        <code className="text-danger">!1-!4</code>
                      </p>
                    </button>
                  </div>
                </div>

                {/* ! → today shortcut */}
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={fullConfig?.exclamation_today !== false}
                    onChange={(e) => handleQuickEntryChange({ exclamation_today: e.target.checked })}
                  />
                  <div>
                    <span className="text-sm text-[var(--text-primary)]">
                      <Trans
                        i18nKey="settings.parser.exclamation"
                        components={{ mark: <code className="rounded-control bg-[var(--bg-secondary)] px-1 py-0.5 text-xs font-mono text-green-600" /> }}
                      />
                    </span>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {t('settings.parser.exclamationNote')}
                    </p>
                  </div>
                </label>
              </>
            )}
          </div>
        </div>

        {saveStatus === 'saving' && (
          <p className="text-xs text-[var(--text-secondary)]">{t('settings.save.saving')}</p>
        )}
        {saveStatus === 'saved' && (
          <p className="text-xs text-status-done">{t('settings.save.saved')}</p>
        )}
        {saveStatus === 'error' && (
          <p className="text-xs text-danger">{t('settings.save.failedNote')}</p>
        )}
      </div>
      ) : activeTab === 'integrations' ? (
      <div className={SETTINGS_COLUMN}>
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
          <p className="text-xs text-[var(--text-secondary)]">{t('settings.save.saving')}</p>
        )}
        {saveStatus === 'saved' && (
          <p className="text-xs text-status-done">{t('settings.save.saved')}</p>
        )}
        {saveStatus === 'error' && (
          <p className="text-xs text-danger">{t('settings.save.failedNote')}</p>
        )}
      </div>
      ) : null}
      </div>
    </ReadingScroll>
    </div>
  )
}
