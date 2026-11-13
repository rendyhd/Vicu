import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

type Level = 'encrypted' | 'obfuscated' | 'plaintext'

/** The heading of the notice, worded for the sign-in token or the assistant's key. */
export function secretNoticeTitle(subject: 'token' | 'key', level: 'obfuscated' | 'plaintext'): string {
  const what = subject === 'key' ? 'The key' : 'Sign-in token'
  return level === 'plaintext' ? `${what} is not encrypted` : `${what} is obfuscated, not encrypted`
}

/**
 * Warns when the sign-in token cannot be stored encrypted (D-AUTH-4). Shows nothing while the OS
 * keychain protects it, so the common case is quiet. `subject` words it for the sign-in token or
 * for the assistant's provider key.
 */
export function SecretStorageNotice({ subject = 'token' }: { subject?: 'token' | 'key' }) {
  const [level, setLevel] = useState<Level | null>(null)

  useEffect(() => {
    api.getSecretStorageStatus().then(setLevel).catch(() => {})
  }, [])

  if (!level || level === 'encrypted') return null

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
        <p>
          This system does not offer secure storage to Vicu, so your {isKey ? 'provider key' : 'sign-in token'} is saved as plain text in Vicu&apos;s
          data folder. Anyone who can read your user profile can read it. Only the file&apos;s permissions protect it.
        </p>
      ) : (
        <p>
          {isLinux ? 'On Linux, Vicu does not use the system keyring. ' : ''}
          Your {isKey ? 'provider key' : 'sign-in token'} is saved in a file in Vicu&apos;s data folder that is only obscured, not protected by a
          key. Anyone who can read your user profile can recover it. Only the file&apos;s permissions protect it.
        </p>
      )}
    </div>
  )
}
