import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

type Level = 'encrypted' | 'obfuscated' | 'plaintext'

/**
 * Warns when the sign-in token cannot be stored encrypted (D-AUTH-4). Shows nothing while the OS
 * keychain protects it, so the common case is quiet.
 */
export function SecretStorageNotice() {
  const [level, setLevel] = useState<Level | null>(null)

  useEffect(() => {
    api.getSecretStorageStatus().then(setLevel).catch(() => {})
  }, [])

  if (!level || level === 'encrypted') return null

  const isLinux = window.api.platform === 'linux'
  return (
    <div
      role="note"
      className="mt-4 rounded-md border border-status-today/40 bg-status-today/10 px-3 py-2 text-xs text-[var(--text-secondary)]"
    >
      <p className="mb-1 font-semibold text-status-today">
        {level === 'plaintext' ? 'Sign-in token is not encrypted' : 'Sign-in token is obfuscated, not encrypted'}
      </p>
      {level === 'plaintext' ? (
        <p>
          This system does not offer secure storage to Vicu, so your sign-in token is saved as plain text in Vicu&apos;s
          data folder. Anyone who can read your user profile can read it. Only the file&apos;s permissions protect it.
        </p>
      ) : (
        <p>
          {isLinux ? 'On Linux, Vicu does not use the system keyring. ' : ''}
          Your sign-in token is saved in a file in Vicu&apos;s data folder that is only obscured, not protected by a
          key. Anyone who can read your user profile can recover it. Only the file&apos;s permissions protect it.
        </p>
      )}
    </div>
  )
}
