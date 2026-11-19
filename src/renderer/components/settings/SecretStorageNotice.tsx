import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { can } from '@/lib/capabilities'
import { useTranslation } from 'react-i18next'
import { t } from '../../../shared/i18n'

type Level = 'encrypted' | 'obfuscated' | 'plaintext'

/** The heading of the notice, worded for the sign-in token or the assistant's key. */
export function secretNoticeTitle(subject: 'token' | 'key', level: 'obfuscated' | 'plaintext'): string {
  if (subject === 'key') {
    return level === 'plaintext' ? t('settings.secretNotice.keyPlaintext') : t('settings.secretNotice.keyObfuscated')
  }
  return level === 'plaintext' ? t('settings.secretNotice.tokenPlaintext') : t('settings.secretNotice.tokenObfuscated')
}

/**
 * Warns when the sign-in token cannot be stored encrypted (D-AUTH-4). Shows nothing while the OS
 * keychain protects it, so the common case is quiet. `subject` words it for the sign-in token or
 * for the assistant's provider key.
 */
export function SecretStorageNotice({ subject = 'token' }: { subject?: 'token' | 'key' }) {
  const { t } = useTranslation()
  const [level, setLevel] = useState<Level | null>(null)

  useEffect(() => {
    if (!can('secretStorage')) return
    api.getSecretStorageStatus().then(setLevel).catch(() => {})
  }, [])

  if (!can('secretStorage') || !level || level === 'encrypted') return null

  const isLinux = window.api.platform === 'linux'
  const isKey = subject === 'key'
  return (
    <div
      role="note"
      className="mt-4 rounded-control border border-status-today/40 bg-status-today/10 px-3 py-2 text-xs text-[var(--text-secondary)]"
    >
      <p className="mb-1 font-semibold text-status-today">
        {secretNoticeTitle(subject, level)}
      </p>
      {level === 'plaintext' ? (
        <p>{isKey ? t('settings.secretNotice.keyPlaintextBody') : t('settings.secretNotice.tokenPlaintextBody')}</p>
      ) : (
        <p>
          {isLinux
            ? isKey
              ? t('settings.secretNotice.keyObfuscatedBodyLinux')
              : t('settings.secretNotice.tokenObfuscatedBodyLinux')
            : isKey
              ? t('settings.secretNotice.keyObfuscatedBody')
              : t('settings.secretNotice.tokenObfuscatedBody')}
        </p>
      )}
    </div>
  )
}
