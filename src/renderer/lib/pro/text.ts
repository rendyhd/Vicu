import { api } from '@/lib/api'
import { getDateFormat } from '@/lib/date-format'
import { formatWeekdayDate, type DateFormat } from '@/lib/date-display'
import { translatorFor } from '../../../shared/i18n'
import type { LocalDate } from '../../../shared/due-dates'
import { renderDocument, type DocTranslate, type ProDocument, type RenderedDocument } from '../../../shared/pro/documents'
import { PRO_TEXT_KEYS } from './text-keys'

/**
 * Text for other people (cross-app semantics 21.19) in the main window: a document's lines come
 * from the catalog in the language chosen for the text, which is not the language the app is shown
 * in, and its days are written in that language too.
 */

const noon = (day: LocalDate): Date => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

/**
 * How days are written in a text's language. English keeps the region's own English (en-GB or
 * en-US, the app's date setting) when the app is shown in English; any other language writes them
 * in its own words.
 */
export function textDateFormat(language: string, app: DateFormat = getDateFormat()): DateFormat {
  const english = (tag: string) => tag.toLowerCase().split('-')[0] === 'en'
  if (english(language)) return english(app.locale) ? { ...app, hour12: false } : { locale: 'en-GB', hour12: false }
  return { locale: language, hour12: false }
}

/** A document in one language: plain text, HTML and Markdown. */
export async function renderProDocument(document: ProDocument, language: string, now: Date = new Date()): Promise<RenderedDocument> {
  const { language: used, t } = await translatorFor(language)
  const translate: DocTranslate = (key, params) => {
    const catalogKey = (PRO_TEXT_KEYS as Record<string, (typeof PRO_TEXT_KEYS)[keyof typeof PRO_TEXT_KEYS]>)[key]
    // A key this version does not know (a document built by a newer rule): shown as it is.
    return catalogKey ? (t as unknown as (key: string, options: Record<string, string | number>) => string)(catalogKey, params) : key
  }
  const fmt = textDateFormat(used)
  return renderDocument(document, translate, (day) => formatWeekdayDate(noon(day), now, fmt))
}

/** Puts a rendered document on the clipboard: HTML and plain text, or Markdown as plain text. */
export async function copyRendered(rendered: RenderedDocument, form: 'rich' | 'markdown' = 'rich'): Promise<void> {
  if (form === 'markdown') await api.writeClipboardRich(rendered.markdown)
  else await api.writeClipboardRich(rendered.text, rendered.html)
}
