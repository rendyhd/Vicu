import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { BrowserSignIn } from '@/components/auth/BrowserSignIn'
import { api, type OIDCProvider, type ServerAuthInfo } from '@/lib/api'
import { cn } from '@/lib/cn'
import { can, isWebHost } from '@/lib/capabilities'
import type { Project } from '@/lib/vikunja-types'
import type { OidcSignInMode } from '../../shared/oidc-browser'
import type { TranslationKey } from '../../shared/i18n'

/** The route groups and permissions an API token needs: Vikunja's own names, the same in every language. */
const TOKEN_PERMISSIONS: { route: string; permission: string; use: TranslationKey }[] = [
  { route: 'tasks', permission: 'read_all, create, update, delete', use: 'settings.tokenPermissions.uses.tasks' },
  { route: 'projects', permission: 'read_all, create, update, delete', use: 'settings.tokenPermissions.uses.projects' },
  { route: 'labels', permission: 'read_all, create, update, delete', use: 'settings.tokenPermissions.uses.labels' },
  { route: 'task_labels', permission: 'create, delete', use: 'settings.tokenPermissions.uses.taskLabels' },
  { route: 'task_relations', permission: 'create, delete', use: 'settings.tokenPermissions.uses.taskRelations' },
  { route: 'task_attachments', permission: 'read_all, create, delete', use: 'settings.tokenPermissions.uses.taskAttachments' },
  { route: 'project_views', permission: 'read_all', use: 'settings.tokenPermissions.uses.projectViews' },
]

function TokenPermissionsInfo() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <span className="relative ml-1 inline-flex">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded-full text-caption font-bold leading-none transition-colors',
          open
            ? 'bg-accent-fill text-on-accent'
            : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-accent-blue/20 hover:text-accent-blue'
        )}
        aria-label={t('settings.tokenPermissions.label')}
      >
        i
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-10 w-80 rounded-popover border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 shadow-lg">
          <p className="mb-2 text-xs text-[var(--text-secondary)]">
            {t('settings.tokenPermissions.intro')}
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-color)] text-left text-[var(--text-secondary)]">
                <th className="pb-1.5 pr-2 font-medium">{t('settings.tokenPermissions.route')}</th>
                <th className="pb-1.5 pr-2 font-medium">{t('settings.tokenPermissions.permission')}</th>
                <th className="pb-1.5 font-medium">{t('settings.tokenPermissions.usedFor')}</th>
              </tr>
            </thead>
            <tbody className="text-[var(--text-primary)]">
              {TOKEN_PERMISSIONS.map((row, index) => (
                <tr key={row.route} className={index < TOKEN_PERMISSIONS.length - 1 ? 'border-b border-border/50' : undefined}>
                  <td className="py-1.5 pr-2 font-mono text-caption">{row.route}</td>
                  <td className="py-1.5 pr-2">{row.permission}</td>
                  <td className="py-1.5">{t(row.use)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </span>
  )
}

export { TokenPermissionsInfo }

/** The web version's "Remember on this browser" choice for an API token; its host reads the key when it saves the connection. */
const REMEMBER_TOKEN_KEY = 'vicu-web-remember-token'

function rememberTokenChoice(remember: boolean): void {
  try {
    if (remember) localStorage.setItem(REMEMBER_TOKEN_KEY, '1')
    else localStorage.removeItem(REMEMBER_TOKEN_KEY)
  } catch {
    // Storage is blocked: the token is then simply not remembered.
  }
}

type Step = 'url' | 'auth-method' | 'oidc-login' | 'oidc-totp' | 'password-login' | 'totp' | 'api-token' | 'project'

// The order the steps are reached in; a step later in it slides in from the right, an earlier one from the left.
const STEP_ORDER: Step[] = ['url', 'auth-method', 'oidc-login', 'oidc-totp', 'password-login', 'totp', 'api-token', 'project']

interface SetupViewProps {
  onComplete: () => void
}

export function SetupView({ onComplete }: SetupViewProps) {
  const { t } = useTranslation()
  // The web version is served next to its server, so the server is this page's own origin and no
  // address is asked for; its SSO sign-in leaves the page and comes back (api.pendingSignIn).
  const web = isWebHost()
  const ownServer = !can('serverChoice')
  const [step, setStep] = useState<Step>('url')
  // Which way the step slid (card 4.11a), read while rendering so the new step starts sliding in its first frame.
  const shown = useRef<{ step: Step; direction: 'forward' | 'back' | null }>({ step: 'url', direction: null })
  if (shown.current.step !== step) {
    shown.current = { step, direction: STEP_ORDER.indexOf(step) >= STEP_ORDER.indexOf(shown.current.step) ? 'forward' : 'back' }
  }
  const [url, setUrl] = useState(ownServer ? window.location.origin : '')
  // Web: keep an API token on this browser between visits (off: it is forgotten when the browser closes).
  const [rememberToken, setRememberToken] = useState(false)
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [inboxProjectId, setInboxProjectId] = useState(0)
  // The logo is a 90 KB data URL. It is loaded here rather than imported, because SettingsView
  // imports TokenPermissionsInfo from this file and a static import would grow its chunk too.
  const [logoUrl, setLogoUrl] = useState('')

  useEffect(() => {
    let cancelled = false
    import('@/assets/vicu-logo').then(({ VICU_LOGO_DATA_URL }) => {
      if (!cancelled) setLogoUrl(VICU_LOGO_DATA_URL)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const [serverAuth, setServerAuth] = useState<ServerAuthInfo | null>(null)
  const [oidcProviders, setOidcProviders] = useState<OIDCProvider[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [oidcLogging, setOidcLogging] = useState(false)
  const [oidcError, setOidcError] = useState('')
  const [selectedOidcProvider, setSelectedOidcProvider] = useState<OIDCProvider | null>(null)
  // Sign in in Vicu's window, or in the browser ('oidc-login' step) where passkeys work.
  const [oidcMode, setOidcMode] = useState<OidcSignInMode>('window')
  const [passkeyPrompted, setPasskeyPrompted] = useState(false)
  const [authMethod, setAuthMethod] = useState<'api_token' | 'oidc' | 'password'>('api_token')

  // Password login state
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [passwordLogging, setPasswordLogging] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  const [projects, setProjects] = useState<Project[]>([])
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testError, setTestError] = useState('')
  const [saving, setSaving] = useState(false)

  const DEFAULT_URL = 'https://app.vikunja.cloud'

  const autoSelectInbox = (projectList: Project[]) => {
    const inbox = projectList.find((p) => p.title.toLowerCase() === 'inbox')
    if (inbox) setInboxProjectId(inbox.id)
  }

  /**
   * The Inbox syncs (cross-app semantics 11.4): before asking, read the account's synced Inbox and
   * preselect it; without one, Vikunja's default project; else a project called Inbox. An API-token
   * setup passes its token, a sign-in uses the session it just stored. Offline it works as before.
   */
  const preselectInbox = async (projectList: Project[], apiToken?: string) => {
    autoSelectInbox(projectList)
    try {
      const prefs = await api.readSetupPreferences(url.replace(/\/+$/, ''), apiToken)
      const exists = (id: number | null): id is number => !!id && projectList.some((project) => project.id === id)
      if (exists(prefs.inboxProjectId)) setInboxProjectId(prefs.inboxProjectId)
      else if (exists(prefs.defaultProjectId)) setInboxProjectId(prefs.defaultProjectId)
    } catch {
      // Nothing synced could be read: the user chooses as before.
    }
  }

  /** Ask the server how it signs people in, and go to the step that follows. */
  const discoverServer = async (effectiveUrl: string): Promise<ServerAuthInfo> => {
    setDiscovering(true)
    const authInfo = await api.discoverAuthMethods(effectiveUrl.replace(/\/+$/, ''))
    setServerAuth(authInfo)
    setOidcProviders(authInfo.oidc_providers)
    setDiscovering(false)

    if (authInfo.local_enabled || authInfo.oidc_enabled) {
      setStep('auth-method')
    } else {
      setStep('api-token')
    }
    return authInfo
  }

  const handleUrlContinue = async () => {
    const effectiveUrl = url.trim() || DEFAULT_URL
    if (!url.trim()) setUrl(effectiveUrl)
    await discoverServer(effectiveUrl)
  }

  // Without a server to choose (the web version) setup starts by asking the page's own server how it
  // signs in. On the web an SSO sign-in leaves the page and returns here: its outcome is read once,
  // and a session that already exists goes straight to choosing the Inbox.
  useEffect(() => {
    if (!ownServer) return
    let live = true
    const begin = async () => {
      const pending = web ? await api.pendingSignIn().catch(() => null) : null
      if (!live) return
      if (!pending && web) {
        const projectsResult = await api.fetchProjects().catch(() => null)
        if (!live) return
        if (projectsResult?.success) {
          const config = await api.getConfig().catch(() => null)
          if (!live) return
          setAuthMethod(config?.auth_method === 'password' ? 'password' : config?.auth_method === 'api_token' ? 'api_token' : 'oidc')
          setProjects(projectsResult.data)
          await preselectInbox(projectsResult.data)
          if (live) setStep('project')
          return
        }
      }
      const authInfo = await discoverServer(window.location.origin)
      if (!live || !pending) return
      const provider = authInfo.oidc_providers.find((p) => p.key === pending.providerKey)
      if (provider) setSelectedOidcProvider(provider)
      if (pending.totpRequired && provider) {
        setOidcMode('window')
        setTotpCode('')
        setStep('oidc-totp')
      } else if (pending.error) {
        setOidcError(pending.error)
      }
    }
    void begin()
    return () => {
      live = false
    }
    // Once, when the view opens.
  }, [])

  const showBrowserSignIn = (provider: OIDCProvider, prompted: boolean) => {
    setSelectedOidcProvider(provider)
    setOidcMode('browser')
    setPasskeyPrompted(prompted)
    setOidcError('')
    setStep('oidc-login')
  }

  const handleOidcLogin = async (provider: OIDCProvider, totpPasscode?: string, mode: OidcSignInMode = oidcMode) => {
    setOidcLogging(true)
    setOidcError('')
    setSelectedOidcProvider(provider)
    setOidcMode(mode)

    // Tell the main process the URL and auth method. Main merges these into the
    // existing config, so hotkeys, theme and other preferences survive a re-login.
    await api.saveConnectionConfig({
      vikunja_url: url.replace(/\/+$/, ''),
      api_token: '',
      auth_method: 'oidc',
    })

    try {
      const signIn = mode === 'browser' ? api.oidcBrowserLogin : api.oidcLogin
      const result = await signIn(
        url.replace(/\/+$/, ''),
        provider.key,
        totpPasscode
      )

      if (result.success) {
        setAuthMethod('oidc')
        // Fetch projects using the now-stored OIDC token
        const projectsResult = await api.fetchProjects()
        if (projectsResult.success) {
          setProjects(projectsResult.data)
          await preselectInbox(projectsResult.data)
          setStep('project')
        } else {
          setOidcError(projectsResult.error)
        }
      } else if (result.totpRequired) {
        setStep('oidc-totp')
        setTotpCode('')
        if (totpPasscode) setOidcError(result.error)
      } else if (result.passkeyUnavailable) {
        showBrowserSignIn(provider, true)
      } else if (!result.cancelled) {
        setOidcError(result.error)
      }
    } catch {
      setOidcError('Login failed unexpectedly. Please try again.')
    } finally {
      setOidcLogging(false)
    }
  }

  const handlePasswordLogin = async (totpPasscode?: string) => {
    setPasswordLogging(true)
    setPasswordError('')

    // Tell the main process the URL and auth method (merged into the existing config).
    await api.saveConnectionConfig({
      vikunja_url: url.replace(/\/+$/, ''),
      api_token: '',
      auth_method: 'password',
    })

    try {
      const result = await api.loginPassword(
        url.replace(/\/+$/, ''),
        username,
        password,
        totpPasscode
      )

      if (result.success) {
        setAuthMethod('password')
        const projectsResult = await api.fetchProjects()
        if (projectsResult.success) {
          setProjects(projectsResult.data)
          await preselectInbox(projectsResult.data)
          setStep('project')
        } else {
          setPasswordError(projectsResult.error)
        }
      } else if (result.totpRequired) {
        setStep('totp')
        setTotpCode('')
        if (totpPasscode) setPasswordError(result.error)
      } else {
        setPasswordError(result.error)
      }
    } catch {
      setPasswordError('Login failed unexpectedly. Please try again.')
    } finally {
      setPasswordLogging(false)
    }
  }

  const handleTestConnection = async () => {
    setTestStatus('testing')
    setTestError('')
    // The web version reads this when the connection is saved: a remembered token stays on this browser.
    if (web) rememberTokenChoice(rememberToken)
    const result = await api.testConnection(url.replace(/\/+$/, ''), token)
    if (result.success) {
      setTestStatus('success')
      setProjects(result.data)
      await preselectInbox(result.data, token)
      setAuthMethod('api_token')
      setStep('project')
    } else {
      setTestStatus('error')
      setTestError(result.error)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    if (web) rememberTokenChoice(rememberToken)
    // Main merges the connection details into the existing config, so app preferences
    // are preserved. If the server URL changed it also resets account-specific data
    // (project IDs, custom lists, etc.), since those belong to the previous server/account.
    await api.saveConnectionConfig({
      vikunja_url: url.replace(/\/+$/, ''),
      api_token: authMethod === 'api_token' ? token : '',
      inbox_project_id: inboxProjectId,
      auth_method: authMethod,
    })
    // If the user is coming from standalone mode, push their local tasks to
    // the freshly chosen inbox so nothing is stranded in offline-cache.json.
    if (can('standalone')) {
      try {
        const standaloneCount = await api.getStandaloneTaskCount()
        if (standaloneCount > 0 && inboxProjectId) {
          await api.uploadStandaloneTasks(inboxProjectId)
        }
      } catch {
        // Best effort — tasks stay in the local store and upload can be retried
        // by re-running setup.
      }
    }
    setSaving(false)
    onComplete()
  }

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-[var(--bg-primary)]">
      {/* Window drag strip — frameless windows need an explicit drag region,
          especially on Wayland where the compositor can't auto-detect one. */}
      <div
        className="absolute inset-x-0 top-0 z-50 h-8"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <div className="w-full max-w-md rounded-card border border-[var(--border-color)] bg-bg-card p-8 shadow-lg">
        <div className="mb-4 h-12 w-12">
          {logoUrl && <img src={logoUrl} alt="" className="h-12 w-12" />}
        </div>
        <h1 className="mb-1 text-page-title text-[var(--text-primary)]">
          Welcome to Vicu
        </h1>
        <p className="mb-6 text-sm text-text-secondary">
          {step === 'url' && !ownServer && 'Enter your Vikunja server URL to get started.'}
          {step === 'auth-method' && 'Choose how to sign in.'}
          {step === 'oidc-login' && 'Complete sign-in in your browser.'}
          {step === 'oidc-totp' && 'Enter your two-factor code to complete SSO.'}
          {step === 'password-login' && 'Sign in with your credentials.'}
          {step === 'totp' && 'Enter your two-factor authentication code.'}
          {step === 'api-token' && 'Enter your API token to connect.'}
          {step === 'project' && 'Choose your inbox project.'}
        </p>

        <div key={step} data-step={step} data-step-direction={shown.current.direction ?? undefined} className={cn('space-y-4', shown.current.direction === 'forward' && 'vicu-step-forward', shown.current.direction === 'back' && 'vicu-step-back')}>
          {/* Step 1: URL Input */}
          {/* With the server fixed (the web version) this step has nothing to ask: discovery is already running. */}
          {step === 'url' && !ownServer && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Server URL
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://app.vikunja.cloud"
                  className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-text-secondary/50"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !discovering) handleUrlContinue()
                  }}
                />
              </div>

              <Button
                variant="primary"
                onClick={handleUrlContinue}
                disabled={discovering}
                className="w-full"
              >
                {discovering ? 'Checking...' : 'Continue'}
              </Button>

              <p className="text-center text-xs text-[var(--text-secondary)]">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => window.api.openDeepLink('https://vikunja.cloud/register')}
                  className="text-accent-blue hover:underline"
                >
                  Sign up
                </button>
              </p>
            </>
          )}

          {/* Step 2: Auth Method Selection */}
          {step === 'auth-method' && (
            <>
              {oidcProviders.map((provider) => (
                <Button
                  key={provider.key}
                  variant="primary"
                  onClick={() => handleOidcLogin(provider, undefined, 'window')}
                  disabled={oidcLogging}
                  className="w-full"
                >
                  {oidcLogging ? 'Waiting for sign-in...' : `Sign in with ${provider.name}`}
                </Button>
              ))}

              {oidcProviders.length > 0 && !web && (
                <Button
                  variant="quiet"
                  onClick={() => showBrowserSignIn(oidcProviders.find((p) => p.key === selectedOidcProvider?.key) ?? oidcProviders[0], false)}
                  disabled={oidcLogging}
                  className="w-full"
                >
                  Uses a passkey? Sign in through your browser
                </Button>
              )}

              {serverAuth?.local_enabled && (
                <>
                  {oidcProviders.length > 0 && (
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-[var(--border-color)]" />
                      <span className="text-xs text-[var(--text-secondary)]">or</span>
                      <div className="h-px flex-1 bg-[var(--border-color)]" />
                    </div>
                  )}

                  <Button
                    variant={oidcProviders.length > 0 ? 'secondary' : 'primary'}
                    onClick={() => {
                      setPasswordError('')
                      setStep('password-login')
                    }}
                    className="w-full"
                  >
                    Sign in with username & password
                  </Button>
                </>
              )}

              {oidcError && (
                <p className="text-xs text-danger">{oidcError}</p>
              )}

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-[var(--border-color)]" />
                <span className="text-xs text-[var(--text-secondary)]">or</span>
                <div className="h-px flex-1 bg-[var(--border-color)]" />
              </div>

              <Button variant="secondary" onClick={() => setStep('api-token')} className="w-full">
                Use API Token instead
              </Button>

              {!ownServer && (
                <Button variant="quiet" onClick={() => setStep('url')} className="w-full">
                  Back
                </Button>
              )}
            </>
          )}

          {/* Step 2a: OIDC sign-in in the browser */}
          {step === 'oidc-login' && !web && selectedOidcProvider && (
            <>
              {oidcProviders.length > 1 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                    Provider
                  </label>
                  <select
                    value={selectedOidcProvider.key}
                    onChange={(e) => {
                      const provider = oidcProviders.find((p) => p.key === e.target.value)
                      if (provider) setSelectedOidcProvider(provider)
                    }}
                    disabled={oidcLogging}
                    className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  >
                    {oidcProviders.map((p) => (
                      <option key={p.key} value={p.key}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <BrowserSignIn
                providerName={selectedOidcProvider.name}
                passkeyPrompted={passkeyPrompted}
                waiting={oidcLogging}
                error={oidcError}
                onStart={() => handleOidcLogin(selectedOidcProvider, undefined, 'browser')}
                onCancel={() => api.cancelOidcBrowserLogin()}
              />

              <Button
                variant="quiet"
                onClick={() => {
                  if (oidcLogging) void api.cancelOidcBrowserLogin()
                  setOidcError('')
                  setPasskeyPrompted(false)
                  setOidcMode('window')
                  setStep('auth-method')
                }}
                className="w-full"
              >
                Back
              </Button>
            </>
          )}

          {/* Step 2b: OIDC TOTP */}
          {step === 'oidc-totp' && selectedOidcProvider && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Two-Factor Code
                </label>
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-center text-lg tracking-widest text-[var(--text-primary)] placeholder:text-text-secondary/50"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && totpCode.length === 6 && !oidcLogging) {
                      handleOidcLogin(selectedOidcProvider, totpCode)
                    }
                  }}
                />
                <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                  Enter the 6-digit code from your authenticator app. Vikunja requires a fresh SSO authorization after the challenge.
                </p>
              </div>

              <Button
                variant="primary"
                onClick={() => handleOidcLogin(selectedOidcProvider, totpCode)}
                disabled={totpCode.length !== 6 || oidcLogging}
                className="w-full"
              >
                {oidcLogging ? 'Waiting for sign-in...' : 'Continue with SSO'}
              </Button>

              {oidcLogging && oidcMode === 'browser' && (
                <Button variant="secondary" onClick={() => api.cancelOidcBrowserLogin()} className="w-full">
                  Cancel
                </Button>
              )}

              {oidcError && (
                <p className="text-xs text-danger">{oidcError}</p>
              )}

              <Button
                variant="quiet"
                onClick={() => {
                  if (oidcLogging && oidcMode === 'browser') void api.cancelOidcBrowserLogin()
                  setTotpCode('')
                  setOidcError('')
                  setStep(oidcMode === 'browser' ? 'oidc-login' : 'auth-method')
                }}
                className="w-full"
              >
                Back
              </Button>
            </>
          )}

          {/* Step 3a: Password Login */}
          {step === 'password-login' && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Username or Email
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username or email"
                  autoComplete="username"
                  className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-text-secondary/50"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && username && password) handlePasswordLogin()
                  }}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 pr-16 text-sm text-[var(--text-primary)] placeholder:text-text-secondary/50"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && username && password) handlePasswordLogin()
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-control px-2 py-0.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <Button
                variant="primary"
                onClick={() => handlePasswordLogin()}
                disabled={!username || !password || passwordLogging}
                className="w-full"
              >
                {passwordLogging ? 'Signing in...' : 'Sign In'}
              </Button>

              {passwordError && (
                <p className="text-xs text-danger">{passwordError}</p>
              )}

              <Button
                variant="quiet"
                onClick={() => {
                  setPasswordError('')
                  setStep(serverAuth?.oidc_enabled || ownServer ? 'auth-method' : 'url')
                }}
                className="w-full"
              >
                Back
              </Button>
            </>
          )}

          {/* Step 3a-ii: TOTP */}
          {step === 'totp' && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Two-Factor Code
                </label>
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-center text-lg tracking-widest text-[var(--text-primary)] placeholder:text-text-secondary/50"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && totpCode.length === 6) handlePasswordLogin(totpCode)
                  }}
                />
                <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                  Enter the 6-digit code from your authenticator app.
                </p>
              </div>

              <Button
                variant="primary"
                onClick={() => handlePasswordLogin(totpCode)}
                disabled={totpCode.length !== 6 || passwordLogging}
                className="w-full"
              >
                {passwordLogging ? 'Verifying...' : 'Verify'}
              </Button>

              {passwordError && (
                <p className="text-xs text-danger">{passwordError}</p>
              )}

              <Button
                variant="quiet"
                onClick={() => {
                  setTotpCode('')
                  setPasswordError('')
                  setStep('password-login')
                }}
                className="w-full"
              >
                Back
              </Button>
            </>
          )}

          {/* Step 3b: API Token */}
          {step === 'api-token' && (
            <>
              {!ownServer && (
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Server URL
                </label>
                <div className="rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                  {url}
                </div>
              </div>
              )}

              <div>
                <label className="mb-1 flex items-center text-xs font-medium text-[var(--text-secondary)]">
                  API Token
                  <TokenPermissionsInfo />
                </label>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Enter your API token"
                    className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 pr-16 text-sm text-[var(--text-primary)] placeholder:text-text-secondary/50"
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

              {web && (
                <label className="flex cursor-pointer items-start gap-2">
                  <Checkbox checked={rememberToken} onChange={(e) => setRememberToken(e.target.checked)} />
                  <span>
                    <span className="block text-sm text-[var(--text-primary)]">{t('settings.webToken.remember')}</span>
                    <span className="block text-xs text-[var(--text-secondary)]">{t('settings.webToken.rememberHint')}</span>
                  </span>
                </label>
              )}

              <Button
                variant="primary"
                onClick={handleTestConnection}
                disabled={!token || testStatus === 'testing'}
                className="w-full"
              >
                {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
              </Button>

              {testStatus === 'error' && (
                <p className="text-xs text-danger">{testError || 'Connection failed'}</p>
              )}

              <Button
                variant="quiet"
                onClick={() => {
                  setTestStatus('idle')
                  setTestError('')
                  setStep(serverAuth ? 'auth-method' : 'url')
                }}
                className="w-full"
              >
                Back
              </Button>
            </>
          )}

          {/* Step 4: Inbox Project Selection */}
          {step === 'project' && (
            <>
              {authMethod === 'oidc' && (
                <p className="text-xs text-status-done">Signed in via SSO</p>
              )}
              {authMethod === 'password' && (
                <p className="text-xs text-status-done">Signed in successfully</p>
              )}
              {authMethod === 'api_token' && (
                <p className="text-xs text-status-done">Connected successfully</p>
              )}

              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Inbox Project
                </label>
                <select
                  value={inboxProjectId}
                  onChange={(e) => setInboxProjectId(Number(e.target.value))}
                  className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                >
                  <option value={0}>Select a project...</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>

              <Button
                variant="primary"
                onClick={handleSave}
                disabled={!inboxProjectId || saving}
                className="w-full"
              >
                {saving ? 'Saving...' : 'Save & Continue'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
