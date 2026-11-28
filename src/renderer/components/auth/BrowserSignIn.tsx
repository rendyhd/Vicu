import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/shared/Button'
import { BROWSER_SIGN_IN_REDIRECT_URI } from '../../../shared/oidc-browser'

interface BrowserSignInProps {
  /** Unknown while signing in again before the server answered. */
  providerName?: string
  /** The sign-in window met a passkey prompt: say why the browser is needed. */
  passkeyPrompted: boolean
  waiting: boolean
  error: string
  onStart: () => void
  onCancel: () => void
}

/**
 * OIDC sign-in in the system browser (src/shared/oidc-browser.ts), for providers that sign in with
 * a passkey. The browser comes back to Vicu on a loopback address, which the provider has to know:
 * the panel shows it with a Copy button, then starts the sign-in and waits for it.
 */
export function BrowserSignIn({ providerName, passkeyPrompted, waiting, error, onStart, onCancel }: BrowserSignInProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(BROWSER_SIGN_IN_REDIRECT_URI).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <>
      {passkeyPrompted && (
        <p className="text-sm text-text">
          {providerName ? t('setup.browserSignIn.passkeyNamed', { provider: providerName }) : t('setup.browserSignIn.passkeyUnnamed')}
        </p>
      )}

      <div>
        <p className="mb-1.5 text-xs text-text-secondary">
          {providerName ? t('setup.browserSignIn.addressNamed', { provider: providerName }) : t('setup.browserSignIn.addressUnnamed')}
        </p>
        <div className="flex items-center gap-2">
          <code
            className="min-w-0 flex-1 select-all break-all rounded-control border border-border bg-bg-page px-2 py-1.5 font-mono text-xs text-text"
            title={BROWSER_SIGN_IN_REDIRECT_URI}
            data-testid="browser-sign-in-redirect"
          >
            {BROWSER_SIGN_IN_REDIRECT_URI}
          </code>
          <Button variant="secondary" onClick={copy} aria-label={t('setup.browserSignIn.copyLabel')}>
            {copied ? t('setup.browserSignIn.copied') : t('setup.browserSignIn.copy')}
          </Button>
        </div>
      </div>

      {waiting ? (
        <>
          <p className="text-xs text-text-secondary" role="status">
            {t('setup.browserSignIn.waiting')}
          </p>
          <Button variant="secondary" onClick={onCancel} className="w-full">
            {t('setup.browserSignIn.cancel')}
          </Button>
        </>
      ) : (
        <Button variant="primary" onClick={onStart} className="w-full">
          {t('setup.browserSignIn.continue')}
        </Button>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </>
  )
}
