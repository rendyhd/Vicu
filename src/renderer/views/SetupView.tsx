import { useState } from 'react'
import { api, type OIDCProvider, type ServerAuthInfo } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { Project } from '@/lib/vikunja-types'

function TokenPermissionsInfo() {
  const [open, setOpen] = useState(false)

  return (
    <span className="relative ml-1 inline-flex">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold leading-none transition-colors',
          open
            ? 'bg-accent-blue text-white'
            : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-accent-blue/20 hover:text-accent-blue'
        )}
        aria-label="Token permissions info"
      >
        i
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-10 w-80 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 shadow-lg">
          <p className="mb-2 text-xs text-[var(--text-secondary)]">
            Your API token needs these permissions:
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-color)] text-left text-[var(--text-secondary)]">
                <th className="pb-1.5 pr-2 font-medium">Route</th>
                <th className="pb-1.5 pr-2 font-medium">Permission</th>
                <th className="pb-1.5 font-medium">Used for</th>
              </tr>
            </thead>
            <tbody className="text-[var(--text-primary)]">
              <tr className="border-b border-[var(--border-color)]/50">
                <td className="py-1.5 pr-2 font-mono text-[10px]">tasks</td>
                <td className="py-1.5 pr-2">read_all, create, update, delete</td>
                <td className="py-1.5">Task CRUD</td>
              </tr>
              <tr className="border-b border-[var(--border-color)]/50">
                <td className="py-1.5 pr-2 font-mono text-[10px]">projects</td>
                <td className="py-1.5 pr-2">read_all, create, update, delete</td>
                <td className="py-1.5">Project CRUD</td>
              </tr>
              <tr className="border-b border-[var(--border-color)]/50">
                <td className="py-1.5 pr-2 font-mono text-[10px]">labels</td>
                <td className="py-1.5 pr-2">read_all, create, update, delete</td>
                <td className="py-1.5">Label CRUD</td>
              </tr>
              <tr className="border-b border-[var(--border-color)]/50">
                <td className="py-1.5 pr-2 font-mono text-[10px]">task_labels</td>
                <td className="py-1.5 pr-2">create, delete</td>
                <td className="py-1.5">Adding/removing labels</td>
              </tr>
              <tr className="border-b border-[var(--border-color)]/50">
                <td className="py-1.5 pr-2 font-mono text-[10px]">task_relations</td>
                <td className="py-1.5 pr-2">create, delete</td>
                <td className="py-1.5">Subtasks & relations</td>
              </tr>
              <tr className="border-b border-[var(--border-color)]/50">
                <td className="py-1.5 pr-2 font-mono text-[10px]">task_attachments</td>
                <td className="py-1.5 pr-2">read_all, create, delete</td>
                <td className="py-1.5">File attachments</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2 font-mono text-[10px]">project_views</td>
                <td className="py-1.5 pr-2">read_all</td>
                <td className="py-1.5">Position sorting</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </span>
  )
}

export { TokenPermissionsInfo }

type Step = 'url' | 'auth-method' | 'oidc-login' | 'password-login' | 'totp' | 'api-token' | 'project'

interface SetupViewProps {
  onComplete: () => void
}

export function SetupView({ onComplete }: SetupViewProps) {
  const [step, setStep] = useState<Step>('url')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [inboxProjectId, setInboxProjectId] = useState(0)

  const [serverAuth, setServerAuth] = useState<ServerAuthInfo | null>(null)
  const [oidcProviders, setOidcProviders] = useState<OIDCProvider[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [oidcLogging, setOidcLogging] = useState(false)
  const [oidcError, setOidcError] = useState('')
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

  const handleUrlContinue = async () => {
    setDiscovering(true)
    const authInfo = await api.discoverAuthMethods(url.replace(/\/+$/, ''))
    setServerAuth(authInfo)
    setOidcProviders(authInfo.oidc_providers)
    setDiscovering(false)

    if (authInfo.local_enabled || authInfo.oidc_enabled) {
      setStep('auth-method')
    } else {
      setStep('api-token')
    }
  }

  const handleOidcLogin = async (provider: OIDCProvider) => {
    setOidcLogging(true)
    setOidcError('')

    // Save partial config so the main process knows the URL and auth method
    await api.saveConfig({
      vikunja_url: url.replace(/\/+$/, ''),
      api_token: '',
      inbox_project_id: 0,
      auth_method: 'oidc',
      theme: 'system',
    })

    try {
      const result = await api.oidcLogin(url.replace(/\/+$/, ''), provider.key)

      if (result.success) {
        setAuthMethod('oidc')
        // Fetch projects using the now-stored OIDC token
        const projectsResult = await api.fetchProjects()
        if (projectsResult.success) {
          setProjects(projectsResult.data)
          setStep('project')
        } else {
          setOidcError(projectsResult.error)
        }
      } else {
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

    // Save partial config so the main process knows the URL and auth method
    await api.saveConfig({
      vikunja_url: url.replace(/\/+$/, ''),
      api_token: '',
      inbox_project_id: 0,
      auth_method: 'password',
      theme: 'system',
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
          setStep('project')
        } else {
          setPasswordError(projectsResult.error)
        }
      } else if (result.totpRequired) {
        setStep('totp')
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
    const result = await api.testConnection(url.replace(/\/+$/, ''), token)
    if (result.success) {
      setTestStatus('success')
      setProjects(result.data)
      setAuthMethod('api_token')
      setStep('project')
    } else {
      setTestStatus('error')
      setTestError(result.error)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    await api.saveConfig({
      vikunja_url: url.replace(/\/+$/, ''),
      api_token: authMethod === 'api_token' ? token : '',
      inbox_project_id: inboxProjectId,
      auth_method: authMethod,
      theme: 'system',
    })
    setSaving(false)
    onComplete()
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg-primary)]">
      <div className="w-full max-w-md rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-8 shadow-lg">
        <h1 className="mb-1 text-xl font-bold text-[var(--text-primary)]">
          Connect to Vikunja
        </h1>
        <p className="mb-6 text-sm text-[var(--text-secondary)]">
          {step === 'url' && 'Enter your server URL to get started.'}
          {step === 'auth-method' && 'Choose how to sign in.'}
          {step === 'oidc-login' && 'Complete sign-in in your browser.'}
          {step === 'password-login' && 'Sign in with your credentials.'}
          {step === 'totp' && 'Enter your two-factor authentication code.'}
          {step === 'api-token' && 'Enter your API token to connect.'}
          {step === 'project' && 'Choose your inbox project.'}
        </p>

        <div className="space-y-4">
          {/* Step 1: URL Input */}
          {step === 'url' && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Server URL
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://vikunja.example.com"
                  className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 focus:border-accent-blue focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && url) handleUrlContinue()
                  }}
                />
              </div>

              <button
                type="button"
                onClick={handleUrlContinue}
                disabled={!url || discovering}
                className={cn(
                  'w-full rounded-md px-4 py-2 text-sm font-medium transition-colors',
                  'bg-accent-blue text-white hover:bg-accent-blue/90',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                {discovering ? 'Checking...' : 'Continue'}
              </button>
            </>
          )}

          {/* Step 2: Auth Method Selection */}
          {step === 'auth-method' && (
            <>
              {oidcProviders.map((provider) => (
                <button
                  key={provider.key}
                  type="button"
                  onClick={() => handleOidcLogin(provider)}
                  disabled={oidcLogging}
                  className={cn(
                    'w-full rounded-md px-4 py-2.5 text-sm font-medium transition-colors',
                    'bg-accent-blue text-white hover:bg-accent-blue/90',
                    'disabled:cursor-not-allowed disabled:opacity-50'
                  )}
                >
                  {oidcLogging ? 'Waiting for browser...' : `Sign in with ${provider.name}`}
                </button>
              ))}

              {serverAuth?.local_enabled && (
                <>
                  {oidcProviders.length > 0 && (
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-[var(--border-color)]" />
                      <span className="text-xs text-[var(--text-secondary)]">or</span>
                      <div className="h-px flex-1 bg-[var(--border-color)]" />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setPasswordError('')
                      setStep('password-login')
                    }}
                    className={cn(
                      'w-full rounded-md px-4 py-2.5 text-sm font-medium transition-colors',
                      oidcProviders.length > 0
                        ? 'border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-primary)]'
                        : 'bg-accent-blue text-white hover:bg-accent-blue/90'
                    )}
                  >
                    Sign in with username & password
                  </button>
                </>
              )}

              {oidcError && (
                <p className="text-xs text-accent-red">{oidcError}</p>
              )}

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-[var(--border-color)]" />
                <span className="text-xs text-[var(--text-secondary)]">or</span>
                <div className="h-px flex-1 bg-[var(--border-color)]" />
              </div>

              <button
                type="button"
                onClick={() => setStep('api-token')}
                className="w-full rounded-md border border-[var(--border-color)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
              >
                Use API Token instead
              </button>

              <button
                type="button"
                onClick={() => setStep('url')}
                className="w-full text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Back
              </button>
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
                  className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 focus:border-accent-blue focus:outline-none"
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
                    className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 pr-16 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 focus:border-accent-blue focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && username && password) handlePasswordLogin()
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handlePasswordLogin()}
                disabled={!username || !password || passwordLogging}
                className={cn(
                  'w-full rounded-md px-4 py-2 text-sm font-medium transition-colors',
                  'bg-accent-blue text-white hover:bg-accent-blue/90',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                {passwordLogging ? 'Signing in...' : 'Sign In'}
              </button>

              {passwordError && (
                <p className="text-xs text-accent-red">{passwordError}</p>
              )}

              <button
                type="button"
                onClick={() => {
                  setPasswordError('')
                  setStep(serverAuth?.oidc_enabled ? 'auth-method' : 'url')
                }}
                className="w-full text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Back
              </button>
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
                  className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-center text-lg tracking-widest text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 focus:border-accent-blue focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && totpCode.length === 6) handlePasswordLogin(totpCode)
                  }}
                />
                <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                  Enter the 6-digit code from your authenticator app.
                </p>
              </div>

              <button
                type="button"
                onClick={() => handlePasswordLogin(totpCode)}
                disabled={totpCode.length !== 6 || passwordLogging}
                className={cn(
                  'w-full rounded-md px-4 py-2 text-sm font-medium transition-colors',
                  'bg-accent-blue text-white hover:bg-accent-blue/90',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                {passwordLogging ? 'Verifying...' : 'Verify'}
              </button>

              {passwordError && (
                <p className="text-xs text-accent-red">{passwordError}</p>
              )}

              <button
                type="button"
                onClick={() => {
                  setTotpCode('')
                  setPasswordError('')
                  setStep('password-login')
                }}
                className="w-full text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Back
              </button>
            </>
          )}

          {/* Step 3b: API Token */}
          {step === 'api-token' && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Server URL
                </label>
                <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                  {url}
                </div>
              </div>

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
                    className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 pr-16 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 focus:border-accent-blue focus:outline-none"
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
                disabled={!token || testStatus === 'testing'}
                className={cn(
                  'w-full rounded-md px-4 py-2 text-sm font-medium transition-colors',
                  'bg-accent-blue text-white hover:bg-accent-blue/90',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
              </button>

              {testStatus === 'error' && (
                <p className="text-xs text-accent-red">{testError || 'Connection failed'}</p>
              )}

              <button
                type="button"
                onClick={() => {
                  setTestStatus('idle')
                  setTestError('')
                  setStep(serverAuth ? 'auth-method' : 'url')
                }}
                className="w-full text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Back
              </button>
            </>
          )}

          {/* Step 4: Inbox Project Selection */}
          {step === 'project' && (
            <>
              {authMethod === 'oidc' && (
                <p className="text-xs text-accent-green">Signed in via SSO</p>
              )}
              {authMethod === 'password' && (
                <p className="text-xs text-accent-green">Signed in successfully</p>
              )}
              {authMethod === 'api_token' && (
                <p className="text-xs text-accent-green">Connected successfully</p>
              )}

              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Inbox Project
                </label>
                <select
                  value={inboxProjectId}
                  onChange={(e) => setInboxProjectId(Number(e.target.value))}
                  className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none"
                >
                  <option value={0}>Select a project...</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={handleSave}
                disabled={!inboxProjectId || saving}
                className={cn(
                  'w-full rounded-md px-4 py-2 text-sm font-medium transition-colors',
                  'bg-accent-blue text-white hover:bg-accent-blue/90',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                {saving ? 'Saving...' : 'Save & Continue'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
