import { BrowserWindow, net } from 'electron'
import { randomUUID } from 'crypto'
import { discoverProviders, type OIDCProvider } from './oidc-discovery'
import { storeJWT, storeAPIToken, storeProviderKey } from './token-store'

const TOKEN_EXCHANGE_TIMEOUT = 15_000
const LOGIN_TIMEOUT = 5 * 60 * 1000 // 5 minutes

/**
 * Run the full interactive OIDC login flow:
 * discover providers, open in-app BrowserWindow, intercept redirect to extract
 * authorization code, exchange code for JWT, and create a backup API token.
 *
 * Uses Vikunja's own frontend callback URL as redirect_uri so no IdP
 * configuration changes are needed.
 *
 * @param vikunjaUrl  Base URL of the Vikunja instance (no trailing slash)
 * @param providerKey Optional provider key; uses first available if omitted
 * @returns The JWT string from Vikunja
 */
export async function loginWithOIDC(
  vikunjaUrl: string,
  providerKey?: string
): Promise<string> {
  const baseUrl = vikunjaUrl.replace(/\/+$/, '')

  // 1. Discover providers
  const providers = await discoverProviders(baseUrl)
  if (providers.length === 0) {
    throw new Error('No OIDC providers available on this Vikunja instance')
  }

  let provider: OIDCProvider | undefined
  if (providerKey) {
    provider = providers.find((p) => p.key === providerKey)
    if (!provider) {
      throw new Error(`OIDC provider "${providerKey}" not found`)
    }
  } else {
    provider = providers[0]
  }

  // 2. Use Vikunja's own frontend callback URL (already allowed in the IdP)
  const redirectUri = `${baseUrl}/auth/openid/${provider.key}`

  // 3. Generate state
  const state = randomUUID()

  // 4. Build authorization URL
  const authUrl =
    `${provider.auth_url}?client_id=${provider.client_id}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&state=${state}` +
    `&scope=${encodeURIComponent(provider.scope)}`

  // 5. Create visible BrowserWindow for login
  let win: BrowserWindow | null = new BrowserWindow({
    width: 800,
    height: 600,
    show: true,
    title: 'Sign in',
    webPreferences: {
      partition: 'persist:oidc-auth',
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // 5b. Diagnostic logging
  console.log('[OIDC] provider:', JSON.stringify(provider, null, 2))
  console.log('[OIDC] redirectUri:', redirectUri)
  console.log('[OIDC] authUrl:', authUrl)

  let succeeded = false
  try {
    // 6. Intercept redirects to extract authorization code
    const codePromise = new Promise<string>((resolve, reject) => {
      const checkForCode = (event: Electron.Event, url: string): void => {
        if (!url.startsWith(redirectUri)) return

        try {
          const parsed = new URL(url)
          const error = parsed.searchParams.get('error')
          if (error) {
            event.preventDefault()
            reject(
              new Error(
                `OIDC login failed: ${error} — ${parsed.searchParams.get('error_description') ?? 'unknown error'}`
              )
            )
            return
          }

          const code = parsed.searchParams.get('code')
          if (code) {
            event.preventDefault()
            resolve(code)
          }
        } catch {
          // Not a valid URL, ignore
        }
      }

      win!.webContents.on('will-redirect', checkForCode)
      win!.webContents.on('will-navigate', checkForCode)

      // Also handle window closed by user
      win!.on('closed', () => {
        reject(new Error('Login window was closed before authentication completed'))
      })
    })

    // 7. Set up timeout
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error('OIDC login timed out after 5 minutes'))
      }, LOGIN_TIMEOUT)
    })

    // 8. Load the auth URL
    win.loadURL(authUrl)

    // 9. Race: code interception vs timeout
    const code = await Promise.race([codePromise, timeoutPromise])

    // 10. Exchange code for JWT
    const tokenUrl = `${baseUrl}/api/v1/auth/openid/${provider.key}/callback`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TOKEN_EXCHANGE_TIMEOUT)

    const tokenResponse = await net.fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        scope: provider.scope,
        redirect_url: redirectUri,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text().catch(() => '')
      throw new Error(
        `Token exchange failed (${tokenResponse.status}): ${body}`
      )
    }

    const tokenData: { token: string } = await tokenResponse.json()
    const jwt = tokenData.token
    if (!jwt) {
      throw new Error('Token exchange response missing "token" field')
    }

    // 11. Store JWT and provider key
    storeJWT(jwt)
    storeProviderKey(provider.key)
    succeeded = true

    // 12. Fire-and-forget: create backup API token
    createBackupAPIToken(baseUrl, jwt).catch(() => {
      // Silently ignore — the JWT is already stored and usable
    })

    // 13. Return JWT
    return jwt
  } finally {
    if (win && !win.isDestroyed()) {
      if (!succeeded) {
        // Clear session cookies on failure so retries start fresh
        await win.webContents.session.clearStorageData().catch(() => {})
      }
      win.destroy()
    }
    win = null
  }
}

async function createBackupAPIToken(
  baseUrl: string,
  jwt: string
): Promise<void> {
  const expirationDate = new Date()
  expirationDate.setDate(expirationDate.getDate() + 365)

  const response = await net.fetch(`${baseUrl}/api/v1/tokens`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      title: 'Vicu Desktop',
      expiration_date: expirationDate.toISOString(),
    }),
  })

  if (!response.ok) return

  const data: { token: string } = await response.json()
  if (data.token) {
    const expiresAtUnix = Math.floor(expirationDate.getTime() / 1000)
    storeAPIToken(data.token, expiresAtUnix)
  }
}
