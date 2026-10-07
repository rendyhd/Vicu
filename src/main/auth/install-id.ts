import { app } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import { writeFileAtomic } from '../atomic-file'
import { generateInstallId, isValidInstallId } from './backup-token'

// A random id that identifies this Vicu install, used as the suffix of the
// backup API token title (see backup-token.ts). It lives in its own file rather
// than in config.json or auth.json on purpose: logging out deletes auth.json and
// the setup flow rewrites config.json, but the id has to stay stable so cleanup
// can still recognize this install's tokens after a logout or re-login.

const INSTALL_ID_FILENAME = 'install-id'

let cached: string | null = null

function installIdPath(): string {
  return join(app.getPath('userData'), INSTALL_ID_FILENAME)
}

export function getInstallId(): string {
  if (cached) return cached
  const path = installIdPath()

  try {
    const existing = readFileSync(path, 'utf-8').trim()
    if (isValidInstallId(existing)) {
      cached = existing
      return existing
    }
  } catch {
    // Missing or unreadable: generate a new one below.
  }

  const id = generateInstallId()
  try {
    writeFileAtomic(path, `${id}\n`)
  } catch (err) {
    // Still usable for this run; a new id is generated next time.
    console.warn('[Auth] Could not persist install id:', err instanceof Error ? err.message : err)
  }
  cached = id
  return id
}
