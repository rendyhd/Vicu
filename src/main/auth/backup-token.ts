import { randomBytes } from 'crypto'

// Naming and matching rules for the backup API token a Vicu install creates on
// the Vikunja server (D-AUTH-1). Pure functions only; the server calls live in
// oidc-login.ts.
//
// Titles look like `Vicu — MY-LAPTOP [a1b2c3]`. The bracketed suffix is a random
// id generated once per install (see install-id.ts), so stale-token cleanup only
// ever touches tokens created by this install. Two machines with the same host
// name get different suffixes and no longer delete each other's tokens. The
// Android app uses the same format.

export const BACKUP_TOKEN_TITLE_PREFIX = 'Vicu'
export const INSTALL_ID_LENGTH = 6

export interface ListedToken {
  id: number
  title: string
  /** RFC 3339 timestamp from `GET /tokens`. */
  expires_at?: string
}

/** Six lowercase hex characters, e.g. `a1b2c3`. */
export function generateInstallId(random: (size: number) => Uint8Array = randomBytes): string {
  const bytes = random(INSTALL_ID_LENGTH / 2)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, INSTALL_ID_LENGTH)
}

export function isValidInstallId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{6}$/.test(id)
}

/** Title used before the per-install suffix existed: `Vicu — <host name>`. */
export function legacyBackupTokenTitle(deviceName: string): string {
  return `${BACKUP_TOKEN_TITLE_PREFIX} — ${deviceName}`
}

export function buildBackupTokenTitle(deviceName: string, installId: string): string {
  return `${legacyBackupTokenTitle(deviceName)} [${installId}]`
}

/** True when `title` is a Vicu token carrying this install's id (any host name). */
export function isOwnedByInstall(title: unknown, installId: string): boolean {
  return (
    isValidInstallId(installId) &&
    typeof title === 'string' &&
    title.startsWith(BACKUP_TOKEN_TITLE_PREFIX) &&
    title.endsWith(`[${installId}]`)
  )
}

/**
 * Ids of this install's tokens other than `keepId`: the stale ones to delete.
 * Tokens from other installs, other apps and the user's own tokens never match.
 */
export function selectSiblingTokenIds(tokens: ListedToken[], installId: string, keepId: number): number[] {
  return tokens.filter((t) => t.id !== keepId && isOwnedByInstall(t.title, installId)).map((t) => t.id)
}

/**
 * Find the token an older Vicu version created on this machine, so it can be
 * revoked. Those tokens have the bare title `Vicu — <host name>` and no stored
 * id, and the title alone cannot tell two machines with the same host name
 * apart. The expiry can: it was set to creation time plus 365 days and stored
 * locally as unix seconds, so a token that has both our title and exactly our
 * expiry (to the second) is ours. Returns null when there is no such token or
 * the match is ambiguous.
 */
export function findLegacyOwnToken(
  tokens: ListedToken[],
  deviceName: string,
  expiresAtUnix: number | null
): ListedToken | null {
  if (expiresAtUnix == null || !Number.isFinite(expiresAtUnix)) return null
  const legacyTitle = legacyBackupTokenTitle(deviceName)
  const matches = tokens.filter((t) => {
    if (t.title !== legacyTitle || typeof t.expires_at !== 'string') return false
    const ms = Date.parse(t.expires_at)
    if (Number.isNaN(ms)) return false
    return Math.abs(Math.floor(ms / 1000) - expiresAtUnix) <= 1
  })
  return matches.length === 1 ? matches[0] : null
}
