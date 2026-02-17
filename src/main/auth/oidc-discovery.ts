import { net } from 'electron'

export interface OIDCProvider {
  name: string
  key: string
  auth_url: string
  client_id: string
  scope: string
}

interface InfoResponse {
  auth?: {
    openid_connect?: {
      enabled?: boolean
      providers?: OIDCProvider[]
    }
  }
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
