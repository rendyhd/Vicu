// A calendar link (contract 20.9): the secret address of an iCalendar file, read whole. One
// connection, one calendar ("feed"). Conditional requests: the ETag and Last-Modified of the last
// good copy go out as If-None-Match and If-Modified-Since, and a 304 keeps the copy as it is (so
// does the same file again, by its hash, from a server that sends neither).

import { createHash } from 'crypto'
import { normaliseFeedUrl } from '../../../shared/calendar-events'
import type { AddCalendarLinkInput } from '../../../shared/calendar-sources'
import { CalendarReadError, asCalendarError, statusMessage } from '../http'
import type { CalendarSource, ReadOutcome, SourceContext } from './types'

export interface LinkConfig {
  url: string
}

const FEED = 'feed'

async function readLink(url: string, ctx: SourceContext, previous?: { etag?: string; lastModified?: string; hash?: string }): Promise<ReadOutcome<LinkConfig>> {
  const http = ctx.http()
  const headers: Record<string, string> = { Accept: 'text/calendar, */*;q=0.5' }
  if (previous?.etag) headers['If-None-Match'] = previous.etag
  if (previous?.lastModified) headers['If-Modified-Since'] = previous.lastModified
  try {
    const response = await http.fetch(url, { headers })
    if (response.status === 304 && previous) return { status: 'unchanged' }
    if (!response.ok) throw statusMessage(response.status, 'link')
    const text = await response.text()
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new CalendarReadError('That link does not give a calendar (no BEGIN:VCALENDAR).', 'format')
    }
    // A server without ETag or Last-Modified sends the same file again: nothing to parse then.
    const hash = createHash('sha256').update(text).digest('hex')
    const validators: Record<string, string> = { hash }
    const etag = response.headers.get('etag')
    const lastModified = response.headers.get('last-modified')
    if (etag) validators.etag = etag
    if (lastModified) validators.lastModified = lastModified
    if (previous?.hash === hash) return { status: 'unchanged', validators }
    return { status: 'changed', documents: [{ key: FEED, ics: text }], validators }
  } catch (error) {
    throw asCalendarError(error, http, 'link')
  }
}

export const icsLinkSource: CalendarSource<LinkConfig> = {
  kind: 'ics',

  parseConfig(value) {
    // Older stores sealed the bare address.
    const url = typeof value === 'string' ? value : typeof (value as LinkConfig | null)?.url === 'string' ? (value as LinkConfig).url : null
    const normal = url ? normaliseFeedUrl(url) : null
    return normal ? { url: normal } : null
  },

  describe(config) {
    try {
      return new URL(config.url).hostname
    } catch {
      return 'Calendar link'
    }
  },

  async connect(input, ctx) {
    const value = (input ?? {}) as Partial<AddCalendarLinkInput>
    const url = normaliseFeedUrl(String(value.url ?? ''))
    if (!url) throw new CalendarReadError('Paste a calendar link that starts with https:// or webcal://.', 'format')
    const name = String(value.name ?? '').trim() || 'Calendar'
    // Read it once before saving, so a wrong link is said at once.
    const first = await readLink(url, ctx)
    return { config: { url }, name, calendars: [{ remoteId: FEED, name }], firstReads: { [FEED]: first } }
  },

  async listCalendars(config) {
    return { config, calendars: [{ remoteId: FEED, name: '' }] }
  },

  covers() {
    return true
  },

  read(config, _remoteId, request, ctx) {
    const validators = request.previous?.validators
    return readLink(config.url, ctx, request.previous ? {
      etag: typeof validators?.etag === 'string' ? validators.etag : undefined,
      lastModified: typeof validators?.lastModified === 'string' ? validators.lastModified : undefined,
      hash: typeof validators?.hash === 'string' ? validators.hash : undefined,
    } : undefined)
  },
}
