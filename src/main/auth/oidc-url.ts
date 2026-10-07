/**
 * URL handling for the interactive OIDC login, free of Electron so it can be tested.
 */

export interface AuthorizationProvider {
  auth_url: string
  client_id: string
  scope: string
}

/** Ask the IdP for a refresh token as well, so the session outlives the access token. */
export function withOfflineAccess(scope: string): string {
  return scope.split(/\s+/).includes('offline_access') ? scope : `${scope} offline_access`
}

/**
 * The URL that starts the login in the sign-in window. Built with URL/URLSearchParams so a
 * `client_id` with reserved characters is encoded, and an `auth_url` that already has a query
 * (a tenant or prompt parameter) keeps it instead of getting a second `?`. The parameters Vicu
 * sets replace same-named ones from the server, so `state` and `response_type` cannot be
 * overridden by the provider list.
 *
 * No PKCE: Vikunja's backend does the token exchange with the IdP using its own client secret and
 * does not forward our code_verifier, so sending a code_challenge fails with invalid_grant.
 */
export function buildAuthorizationUrl(
  provider: AuthorizationProvider,
  redirectUri: string,
  state: string,
  extraParams: Record<string, string> = {},
): string {
  let url: URL
  try {
    url = new URL(provider.auth_url)
  } catch {
    throw new Error('The server returned an invalid authorization URL for this provider')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The server returned an invalid authorization URL for this provider')
  }

  const params = url.searchParams
  params.set('client_id', provider.client_id)
  params.set('redirect_uri', redirectUri)
  params.set('response_type', 'code')
  params.set('state', state)
  params.set('scope', withOfflineAccess(provider.scope))
  for (const [name, value] of Object.entries(extraParams)) params.set(name, value)
  // URLSearchParams writes a space as "+"; %20 is what encodeURIComponent produced before and is
  // understood by every provider. A literal plus is already %2B.
  url.search = params.toString().replace(/\+/g, '%20')
  return url.toString()
}

export type RedirectOutcome =
  | { kind: 'ignore' }
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string }

function stripTrailingSlashes(path: string): string {
  return path.replace(/\/+$/, '')
}

/** Wording of the error message, so the silent sign-in can keep its own. */
export interface RedirectWording {
  errorPrefix?: string
  defaultErrorDescription?: string
}

/**
 * Decide what a navigation in the sign-in window means. Only the redirect URI itself counts
 * (same origin and path, not a longer path that merely starts with it). A code is accepted only
 * when the `state` it carries is the one this login started with: otherwise the response belongs
 * to some other login attempt and exchanging it could sign Vicu in to someone else's session.
 */
export function interpretRedirect(
  url: string,
  redirectUri: string,
  expectedState: string,
  wording: RedirectWording = {},
): RedirectOutcome {
  let parsed: URL
  let target: URL
  try {
    parsed = new URL(url)
    target = new URL(redirectUri)
  } catch {
    return { kind: 'ignore' }
  }
  if (parsed.origin !== target.origin || stripTrailingSlashes(parsed.pathname) !== stripTrailingSlashes(target.pathname)) {
    return { kind: 'ignore' }
  }

  const error = parsed.searchParams.get('error')
  if (error) {
    return {
      kind: 'error',
      message:
        `${wording.errorPrefix ?? 'OIDC login failed'}: ${error} — ` +
        (parsed.searchParams.get('error_description') ?? wording.defaultErrorDescription ?? 'unknown error'),
    }
  }

  const code = parsed.searchParams.get('code')
  if (!code) return { kind: 'ignore' }

  const state = parsed.searchParams.get('state')
  if (!state || state !== expectedState) {
    return {
      kind: 'error',
      message:
        'The sign-in response did not match this login attempt (state mismatch), so it was ignored. Please try again.',
    }
  }
  return { kind: 'code', code }
}
