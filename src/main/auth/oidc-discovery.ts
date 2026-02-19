import { net } from 'electron'

export interface OIDCProvider {
  name: string
  key: string
  auth_url: string
  client_id: string
  scope: string
}

export interface ServerAuthInfo {
  local_enabled: boolean
  oidc_enabled: boolean
  oidc_providers: OIDCProvider[]
  totp_enabled: boolean
}

interface InfoResponse {
  auth?: {
    local?: {
      enabled?: boolean
    }
    openid_connect?: {
      enabled?: boolean
      providers?: OIDCProvider[]
    }
  }
  totp_enabled?: boolean
}

const DISCOVERY_TIMEOUT = 10_000

/**
 * Fetch OIDC providers from the Vikunja `/api/v1/info` endpoint.
 * Returns an empty array if OIDC is not enabled, no providers exist,
 * or the request fails for any reason.
 */
export async function discoverProviders(vikunjaUrl: string): Promise<OIDCProvider[]> {
  const url = `${vikunjaUrl.replace(/\/+$/, '')}/api/v1/info`

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT)

    const response = await net.fetch(url, { signal: controller.signal })
    clearTimeout(timer)

    if (!response.ok) return []

    const info: InfoResponse = await response.json()

    const oidc = info?.auth?.openid_connect
    if (!oidc?.enabled || !Array.isArray(oidc.providers)) return []

    return oidc.providers
  } catch {
    return []
  }
}

/**
 * Discover all available auth methods from the Vikunja `/api/v1/info` endpoint.
 * Defaults local_enabled to true (Vikunja's default when not specified).
 */
export async function discoverAuthMethods(vikunjaUrl: string): Promise<ServerAuthInfo> {
  const url = `${vikunjaUrl.replace(/\/+$/, '')}/api/v1/info`

  const fallback: ServerAuthInfo = {
    local_enabled: true,
    oidc_enabled: false,
    oidc_providers: [],
    totp_enabled: false,
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT)

    const response = await net.fetch(url, { signal: controller.signal })
    clearTimeout(timer)

    if (!response.ok) return fallback

    const info: InfoResponse = await response.json()

    const oidc = info?.auth?.openid_connect
    const oidcEnabled = oidc?.enabled === true && Array.isArray(oidc.providers) && oidc.providers.length > 0

    return {
      local_enabled: info?.auth?.local?.enabled !== false,
      oidc_enabled: oidcEnabled,
      oidc_providers: oidcEnabled ? oidc!.providers! : [],
      totp_enabled: info?.totp_enabled === true,
    }
  } catch {
    return fallback
  }
}
