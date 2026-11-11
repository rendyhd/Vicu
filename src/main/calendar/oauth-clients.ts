// The OAuth clients the Microsoft 365 and Google calendar sign-ins use (plan phase 2e).
//
// OFFICIAL_CLIENTS is the one place for Vicu's registered clients: fill in the ids once the apps are
// registered (docs/calendar-oauth-setup.md). While a provider's id is empty, the add dialog says so
// and offers "Use my own client". A Microsoft client is public (no secret). A Google Desktop client
// comes with a secret that Google documents as not confidential for installed apps; it ships here
// like the id.
//
// "Use my own client" is per device: userData/calendar-oauth-clients.json (file mode 600), each
// client sealed with safeStorage (../safe-storage.ts). An own client is used instead of the
// official one. Never synced, kept through signing out (it belongs to the device, like the
// calendars). A connection keeps the client it signed in with in its own sealed config, so changing
// the client here affects new sign-ins only.

import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { readFileWithBackup, writeFileAtomicAsync } from '../atomic-file'
import { openSecret, sealSecret } from '../safe-storage'
import {
  checkOwnClient,
  type CalendarAccountProvider,
  type OAuthClientsView,
  type OwnOAuthClientInput,
} from '../../shared/calendar-accounts'
import { testOfficialClient, type OAuthClient } from './oauth'

/** Vicu's registered clients. Empty until registered: see docs/calendar-oauth-setup.md. */
export const OFFICIAL_CLIENTS: Record<CalendarAccountProvider, { clientId: string; clientSecret?: string }> = {
  // Microsoft Entra app registration, "Application (client) ID".
  microsoft: { clientId: '' },
  // Google Cloud, OAuth client of the type "Desktop app": its client id and client secret.
  google: { clientId: '', clientSecret: '' },
}

export function officialClient(provider: CalendarAccountProvider): OAuthClient | null {
  const official = testOfficialClient(provider) ?? OFFICIAL_CLIENTS[provider]
  if (!official.clientId) return null
  return { id: official.clientId, secret: official.clientSecret || undefined, own: false }
}

interface OwnClientsFile {
  version: 1
  clients: Partial<Record<CalendarAccountProvider, string>>
}

function filePath(): string {
  return join(app.getPath('userData'), 'calendar-oauth-clients.json')
}

let cache: OwnClientsFile | null = null

function readFile(): OwnClientsFile {
  if (cache) return cache
  cache = { version: 1, clients: {} }
  const path = filePath()
  if (existsSync(path)) {
    const result = readFileWithBackup(path, (raw) => {
      const value = JSON.parse(raw) as Partial<OwnClientsFile>
      const clients: OwnClientsFile['clients'] = {}
      for (const provider of ['microsoft', 'google'] as const) {
        const sealed = value?.clients?.[provider]
        if (typeof sealed === 'string' && sealed) clients[provider] = sealed
      }
      return { version: 1 as const, clients }
    })
    if (result) cache = result.value
  }
  return cache
}

/** The user's own client for a provider on this device, if saved. */
export async function ownClient(provider: CalendarAccountProvider): Promise<OAuthClient | null> {
  const sealed = readFile().clients[provider]
  if (!sealed) return null
  const text = await openSecret(sealed)
  if (!text) return null
  try {
    const value = JSON.parse(text) as OwnOAuthClientInput
    const checked = checkOwnClient(provider, value)
    return checked.ok ? { id: checked.value.clientId, secret: checked.value.clientSecret, own: true } : null
  } catch {
    return null
  }
}

/** The client a new sign-in uses: the own one, else the official one; null when there is neither. */
export async function clientFor(provider: CalendarAccountProvider): Promise<OAuthClient | null> {
  return (await ownClient(provider)) ?? officialClient(provider)
}

/** Save (or with null remove) the own client of a provider. Throws a sentence when it does not fit. */
export async function setOwnClient(provider: CalendarAccountProvider, input: OwnOAuthClientInput | null): Promise<void> {
  const file = readFile()
  const clients = { ...file.clients }
  if (input === null) {
    delete clients[provider]
  } else {
    const checked = checkOwnClient(provider, input)
    if (!checked.ok) throw new Error(checked.error)
    clients[provider] = await sealSecret(JSON.stringify(checked.value))
  }
  cache = { version: 1, clients }
  await writeFileAtomicAsync(filePath(), JSON.stringify(cache), { backup: true, mode: 0o600 })
}

export async function oauthClientsView(): Promise<OAuthClientsView> {
  const view = {} as OAuthClientsView
  for (const provider of ['microsoft', 'google'] as const) {
    const own = await ownClient(provider)
    view[provider] = { provider, official: officialClient(provider) !== null, own: own !== null, ...(own ? { ownClientId: own.id } : {}) }
  }
  return view
}
