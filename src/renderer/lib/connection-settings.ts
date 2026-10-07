import type { ConnectionConfig } from './vikunja-types'

/**
 * The connection to save after Settings' "Test connection" succeeded. It is saved with
 * `saveConnectionConfig`, never as a config patch: only that path treats a new URL or token as an
 * account change (clearing the cached known user, the previous account's cached lists and, in the
 * main process, refusing to replay changes queued for another user). The inbox project is left out
 * so the saved one is kept for the same server.
 */
export function connectionAfterTest(
  url: string,
  token: string,
  authMethod: ConnectionConfig['auth_method'],
): ConnectionConfig {
  return {
    vikunja_url: url,
    api_token: authMethod === 'api_token' ? token : '',
    auth_method: authMethod,
  }
}
