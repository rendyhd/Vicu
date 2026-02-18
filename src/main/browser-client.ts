import { app } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'

export interface BrowserContext {
  url: string
  title: string
  displayTitle: string
}

const MAX_AGE_MS = 3000

function getContextFilePath(): string {
  return join(app.getPath('userData'), 'browser-context.json')
}

export function getBrowserContext(): BrowserContext | null {
  try {
    const raw = readFileSync(getContextFilePath(), 'utf-8')
    const data = JSON.parse(raw) as { url?: string; title?: string; timestamp?: number }
    if (!data.url || typeof data.url !== 'string') return null
    if (typeof data.timestamp === 'number' && Date.now() - data.timestamp > MAX_AGE_MS) return null

    const title = typeof data.title === 'string' ? data.title : data.url
    const displayTitle = title.length > 40 ? title.slice(0, 37) + '...' : title

    return { url: data.url, title, displayTitle }
  } catch {
    return null
  }
}
