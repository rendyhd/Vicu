import * as https from 'node:https'
import * as crypto from 'node:crypto'
import { loadConfig } from './config'

const OBSIDIAN_TIMEOUT = 300

export interface ObsidianNoteContext {
  deepLink: string
  noteName: string
  vaultName: string
  isUidBased: boolean
}

interface ActiveNoteResponse {
  path: string
  content: string
  frontmatter: Record<string, unknown>
  stat: Record<string, unknown>
}

// Use Node https with rejectUnauthorized:false scoped to Obsidian only
// (net.request certificate-error may not fire for programmatic requests)
const agent = new https.Agent({ rejectUnauthorized: false })

function obsidianRequest<T>(
  method: string,
  apiKey: string,
  port: number,
  path: string,
  body?: unknown,
  contentType?: string
): Promise<T | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), OBSIDIAN_TIMEOUT)

    try {
      const options: https.RequestOptions = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        agent,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/vnd.olrapi.note+json',
          ...(contentType ? { 'Content-Type': contentType } : {}),
        },
      }

      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk.toString() })
        res.on('end', () => {
          clearTimeout(timeout)
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data) as T)
            } catch {
              resolve(null)
            }
          } else {
            if (res.statusCode === 401) console.warn('Obsidian: bad API key')
            resolve(null)
          }
        })
      })

      req.on('error', () => {
        clearTimeout(timeout)
        resolve(null)
      })

      if (body !== undefined) {
        req.write(JSON.stringify(body))
      }
      req.end()
    } catch {
      clearTimeout(timeout)
      resolve(null)
    }
  })
}

export function getActiveNote(apiKey: string, port = 27124): Promise<ActiveNoteResponse | null> {
  return obsidianRequest<ActiveNoteResponse>('GET', apiKey, port, '/active/')
}

export function injectUID(apiKey: string, uid: string, port = 27124): Promise<boolean> {
  return obsidianRequest<unknown>(
    'PATCH',
    apiKey,
    port,
    '/active/',
    { frontmatter: { uid } },
    'application/vnd.olrapi.note+json'
  ).then((result) => result !== null)
}

// Separate function for connection testing — distinguishes "not running" from "no note open"
export function testObsidianConnection(apiKey: string, port = 27124): Promise<{ reachable: boolean; noteName?: string }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ reachable: false }), OBSIDIAN_TIMEOUT * 2)

    try {
      const options: https.RequestOptions = {
        hostname: '127.0.0.1',
        port,
        path: '/active/',
        method: 'GET',
        agent,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/vnd.olrapi.note+json',
        },
      }

      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk.toString() })
        res.on('end', () => {
          clearTimeout(timeout)
          if (res.statusCode === 401) {
            resolve({ reachable: false })
            return
          }
          // 404 means server is reachable but no note is open
          if (res.statusCode === 404) {
            resolve({ reachable: true })
            return
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(data) as ActiveNoteResponse
              resolve({ reachable: true, noteName: parsed.path })
            } catch {
              resolve({ reachable: true })
            }
          } else {
            resolve({ reachable: false })
          }
        })
      })

      req.on('error', () => {
        clearTimeout(timeout)
        resolve({ reachable: false })
      })

      req.end()
    } catch {
      clearTimeout(timeout)
      resolve({ reachable: false })
    }
  })
}

export async function getObsidianContext(): Promise<ObsidianNoteContext | null> {
  const config = loadConfig()
  if (!config) return null
  if (config.obsidian_mode === 'off') return null
  if (!config.obsidian_api_key) return null

  const port = config.obsidian_port || 27124
  const note = await getActiveNote(config.obsidian_api_key, port)
  if (!note) return null

  const vaultName = config.obsidian_vault_name || ''
  const notePath = note.path || ''
  const noteName = notePath.replace(/\.md$/i, '').split('/').pop() || 'Untitled'

  let uid = (note.frontmatter?.uid as string) || ''
  let isUidBased = false

  if (uid) {
    isUidBased = true
  } else {
    // Try to inject a UID
    uid = crypto.randomUUID()
    const injected = await injectUID(config.obsidian_api_key, uid, port)
    if (injected) {
      isUidBased = true
    } else {
      // Fall back to path-based URI
      uid = ''
      isUidBased = false
    }
  }

  let deepLink: string
  if (isUidBased) {
    deepLink = `obsidian://advanced-uri?vault=${encodeURIComponent(vaultName)}&uid=${encodeURIComponent(uid)}`
  } else {
    const pathWithoutMd = notePath.replace(/\.md$/i, '')
    deepLink = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(pathWithoutMd)}`
  }

  return { deepLink, noteName, vaultName, isUidBased }
}
