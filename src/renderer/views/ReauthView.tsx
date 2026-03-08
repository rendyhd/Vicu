import { useState } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'

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
      } else {
        setError(result.error)
      }
    } catch {
      setError('Login failed unexpectedly. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleOidcLogin = async () => {
    setLoading(true)
    setError('')

    try {
      const result = await api.oidcLogin(vikunjaUrl, '')
      if (result.success) {
        onSuccess()
      } else {
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
      <div className="w-full max-w-md rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-8 shadow-lg">
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
          {authMethod === 'oidc' && (
            <button
              type="button"
              onClick={handleOidcLogin}
              disabled={loading}
              className={cn(
                'w-full rounded-md px-4 py-2.5 text-sm font-medium transition-colors',
                'bg-accent-blue text-white hover:bg-accent-blue/90',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              {loading ? 'Waiting for browser...' : 'Sign in with SSO'}
            </button>
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
                disabled={!username || !password || loading}
                className={cn(
                  'w-full rounded-md px-4 py-2 text-sm font-medium transition-colors',
                  'bg-accent-blue text-white hover:bg-accent-blue/90',
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
                disabled={totpCode.length !== 6 || loading}
                className={cn(
                  'w-full rounded-md px-4 py-2 text-sm font-medium transition-colors',
                  'bg-accent-blue text-white hover:bg-accent-blue/90',
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
            <p className="text-xs text-accent-red">{error}</p>
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
