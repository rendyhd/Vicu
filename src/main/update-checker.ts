import { app } from 'electron'
import { net } from 'electron'
import { decodeUtf8Chunks } from './response-body'
import { isNewerVersion, type UpdateStatus } from './update-version'

export type { UpdateStatus }

const GITHUB_API_URL = 'https://api.github.com/repos/rendyhd/vicu/releases/latest'
const CACHE_DURATION_MS = 60 * 60 * 1000 // 1 hour
const REQUEST_TIMEOUT_MS = 10_000

let cachedStatus: UpdateStatus | null = null
let lastCheckTime = 0

function fetchLatestRelease(): Promise<UpdateStatus> {
  return new Promise((resolve) => {
    const currentVersion = app.getVersion()
    const fallback: UpdateStatus = {
      available: false,
      currentVersion,
      latestVersion: currentVersion,
      releaseUrl: '',
      releaseNotes: '',
    }

    const timeout = setTimeout(() => resolve(fallback), REQUEST_TIMEOUT_MS)

    try {
      const req = net.request({ method: 'GET', url: GITHUB_API_URL })
      req.setHeader('Accept', 'application/vnd.github.v3+json')
      req.setHeader('User-Agent', `Vicu/${currentVersion}`)

      const bodyChunks: Buffer[] = []

      req.on('response', (response) => {
        response.on('data', (chunk) => {
          bodyChunks.push(Buffer.from(chunk))
        })

        response.on('end', () => {
          clearTimeout(timeout)
          const body = decodeUtf8Chunks(bodyChunks)

          if (response.statusCode !== 200) {
            resolve(fallback)
            return
          }

          try {
            const data = JSON.parse(body)
            const tagName = data.tag_name as string
            const latestVersion = tagName.replace(/^v/, '')
            const available = isNewerVersion(currentVersion, latestVersion)

            resolve({
              available,
              currentVersion,
              latestVersion,
              releaseUrl: data.html_url ?? '',
              releaseNotes: data.body ?? '',
            })
          } catch {
            resolve(fallback)
          }
        })
      })

      req.on('error', () => {
        clearTimeout(timeout)
        resolve(fallback)
      })

      req.end()
    } catch {
      clearTimeout(timeout)
      resolve(fallback)
    }
  })
}

export async function checkForUpdates(force = false): Promise<UpdateStatus> {
  const now = Date.now()
  if (!force && cachedStatus && now - lastCheckTime < CACHE_DURATION_MS) {
    return cachedStatus
  }

  const status = await fetchLatestRelease()
  cachedStatus = status
  lastCheckTime = now
  return status
}

export function getCachedUpdateStatus(): UpdateStatus | null {
  return cachedStatus
}
