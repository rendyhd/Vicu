import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { connectionAfterTest } from '../connection-settings'

describe('connectionAfterTest (F3)', () => {
  it('keeps the token for an API token connection and leaves the inbox project alone', () => {
    const connection = connectionAfterTest('https://tasks.example.com', 'tk_abc', 'api_token')
    expect(connection).toEqual({ vikunja_url: 'https://tasks.example.com', api_token: 'tk_abc', auth_method: 'api_token' })
    expect('inbox_project_id' in connection).toBe(false)
  })

  it.each(['oidc', 'password'] as const)('never carries a token for a %s sign-in', (method) => {
    expect(connectionAfterTest('https://tasks.example.com', 'tk_abc', method).api_token).toBe('')
  })
})

// Connection settings only reach the main process through saveConnectionConfig. A config patch that
// names them is refused there, and this keeps the renderer from sending one in the first place.
describe('the renderer never patches connection settings (F3)', () => {
  const root = resolve(__dirname, '..', '..')

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (name === '__tests__' || name === 'node_modules') return []
      if (statSync(path).isDirectory()) return sources(path)
      return /\.(ts|tsx)$/.test(name) ? [path] : []
    })
  }

  const patchCall = /\b(?:saveConfigPatch|handleQuickEntryChange|onChange)\(\s*\{[^}]*\b(?:vikunja_url|api_token|auth_method|standalone_mode)\b/

  it('has no saveConfigPatch / settings onChange call that includes a connection key', () => {
    const offenders = sources(root).filter((file) => patchCall.test(readFileSync(file, 'utf-8')))
    expect(offenders).toEqual([])
  })
})
