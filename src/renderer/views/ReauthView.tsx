import { useEffect, useState } from 'react'
import { BrowserSignIn } from '@/components/auth/BrowserSignIn'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { isWebHost } from '@/lib/capabilities'
import type { OidcSignInMode } from '../../shared/oidc-browser'

interface ReauthViewProps {
  authMethod: string
  vikunjaUrl: string
  lastUsername?: string
  onSuccess: () => void
  onSwitchAccount: () => void
}

export function ReauthView({
  authMethod,
  vikunjaUrl,
  lastUsername,
  onSuccess,
  onSwitchAccount,
}: ReauthViewProps) {
  const [username, setUsername] = useState(lastUsername ?? '')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const [needsOidcTotp, setNeedsOidcTotp] = useState(false)
  // Start the way the last sign-in went: in Vicu's window, or in the browser for a passkey.
  const [oidcMode, setOidcMode] = useState<OidcSignInMode>('window')
  const [passkeyPrompted, setPasskeyPrompted] = useState(false)
  const [providerName, setProviderName] = useState<string | undefined>()
  // The web version signs in to SSO by leaving the page, so there is no "in the browser instead" mode.
  const web = isWebHost()
  // The provider a sign-in that left the page came back from (it asked for a two-factor code).
  const [pendingProvider, setPendingProvider] = useState('')

  // The web version: what the sign-in that left the page came back with, read once.
  useEffect(() => {
    if (!web) return
    let live = true
    void api.pendingSignIn()
      .then((pending) => {
        if (!live || !pending) return
        if (pending.totpRequired) {
          setPendingProvider(pending.providerKey)
          setNeedsOidcTotp(true)
          setTotpCode('')
        } else if (pending.error) {
          setError(pending.error)
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [web])

  useEffect(() => {
    if (authMethod !== 'oidc') return
    let live = true
    void Promise.all([api.getOidcSignIn(), api.discoverOidc(vikunjaUrl)])
      .then(([last, providers]) => {
        if (!live) return
        setOidcMode(web ? 'window' : last.mode)
        setProviderName((providers.find((p) => p.key === last.providerKey) ?? providers[0])?.name)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [authMethod, vikunjaUrl, web])

  const handlePasswordLogin = async (totpPasscode?: string) => {
    setLoading(true)
    setError('')

    try {
      const result = await api.loginPassword(
        vikunjaUrl,
        username,
        password,
        totpPasscode
      )

      if (result.success) {
        onSuccess()
      } else if (result.totpRequired) {
        setNeedsTotp(true)
        setTotpCode('')
        if (totpPasscode) setError(result.error)
      } else {
        setError(result.error)
      }
    } catch {
      setError('Login failed unexpectedly. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleOidcLogin = async (totpPasscode?: string, mode: OidcSignInMode = oidcMode) => {
    setLoading(true)
    setError('')
    setOidcMode(mode)

    try {
      // No provider key: main signs in with the provider used last time.
      const signIn = mode === 'browser' && !web ? api.oidcBrowserLogin : api.oidcLogin
      const result = await signIn(vikunjaUrl, pendingProvider, totpPasscode)
      if (result.success) {
        onSuccess()
      } else if (result.totpRequired) {
        setNeedsOidcTotp(true)
        setTotpCode('')
        if (totpPasscode) setError(result.error)
      } else if (result.passkeyUnavailable) {
        setOidcMode('browser')
        setPasskeyPrompted(true)
      } else if (!result.cancelled) {
        setError(result.error)
      }
    } catch {
      setError('Login failed unexpectedly. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg-primary)]">
      <div className="w-full max-w-md rounded-card border border-[var(--border-color)] bg-[var(--bg-secondary)] p-8 shadow-lg">
        <h1 className="mb-1 text-xl font-bold text-[var(--text-primary)]">
          Session Expired
        </h1>
        <p className="mb-2 text-sm text-[var(--text-secondary)]">
          Please sign in again to continue.
        </p>
        <p className="mb-6 text-xs text-[var(--text-secondary)]">
          {vikunjaUrl}
        </p>

        <div className="space-y-4">
          {authMethod === 'oidc' && !needsOidcTotp && oidcMode === 'window' && (
            <>
              <button
                type="button"
                onClick={() => handleOidcLogin(undefined, 'window')}
                disabled={loading}
                className={cn(
                  'w-full rounded-control px-4 py-2.5 text-sm font-medium transition-colors',
                  'bg-accent-fill text-on-accent hover:bg-accent-fill/90',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                {loading ? 'Waiting for sign-in...' : providerName ? `Sign in with ${providerName}` : 'Sign in with SSO'}
              </button>
              {!web && (
              <button
                type="button"
                onClick={() => {
                  setError('')
                  setOidcMode('browser')
                }}
                disabled={loading}
                className="w-full text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
              >
                Uses a passkey? Sign in through your browser
              </button>
              )}
            </>
          )}

          {authMethod === 'oidc' && !web && !needsOidcTotp && oidcMode === 'browser' && (
            <>
              <BrowserSignIn
                providerName={providerName}
                passkeyPrompted={passkeyPrompted}
                waiting={loading}
                error=""
                onStart={() => handleOidcLogin(undefined, 'browser')}
                onCancel={() => api.cancelOidcBrowserLogin()}
              />
              <button
                type="button"
                onClick={() => {
                  if (loading) void api.cancelOidcBrowserLogin()
                  setError('')
                  setPasskeyPrompted(false)
                  setOidcMode('window')
                }}
                className="w-full text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Sign in in Vicu's window instead
              </button>
            </>
          )}

          {authMethod === 'oidc' && needsOidcTotp && (
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
                    if (e.key === 'Enter' && totpCode.length === 6 && !loading) handleOidcLogin(totpCode)
                  }}
                />
                <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                  Enter the 6-digit code from your authenticator app, then complete SSO once more.
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleOidcLogin(totpCode)}
                disabled={totpCode.length !== 6 || loading}
                className={cn(
                  'w-full rounded-control px-4 py-2 text-sm font-medium transition-colors',
                  'bg-accent-fill text-on-accent hover:bg-accent-fill/90',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                {loading ? 'Waiting for sign-in...' : 'Continue with SSO'}
              </button>

              {loading && oidcMode === 'browser' && (
                <button
                  type="button"
                  onClick={() => api.cancelOidcBrowserLogin()}
                  className="w-full text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Cancel
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (loading && oidcMode === 'browser') void api.cancelOidcBrowserLogin()
                  setNeedsOidcTotp(false)
                  setTotpCode('')
                  setError('')
                }}
                className="w-full text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Back
              </button>
            </>
          )}

          {authMethod === 'password' && !needsTotp && (
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

              <button
                type="button"
                onClick={() => handlePasswordLogin()}
                disabled={!username || !password || loading}
                className={cn(
                  'w-full rounded-control px-4 py-2 text-sm font-medium transition-colors',
                  'bg-accent-fill text-on-accent hover:bg-accent-fill/90',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </>
          )}

          {authMethod === 'password' && needsTotp && (
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

              <button
                type="button"
                onClick={() => handlePasswordLogin(totpCode)}
                disabled={totpCode.length !== 6 || loading}
                className={cn(
                  'w-full rounded-control px-4 py-2 text-sm font-medium transition-colors',
                  'bg-accent-fill text-on-accent hover:bg-accent-fill/90',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setNeedsTotp(false)
                  setTotpCode('')
                  setError('')
                }}
                className="w-full text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Back
              </button>
            </>
          )}

          {error && (
            <p className="text-xs text-danger">{error}</p>
          )}

          <button
            type="button"
            onClick={onSwitchAccount}
            className="w-full text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Use a different account
          </button>
        </div>
      </div>
    </div>
  )
}
