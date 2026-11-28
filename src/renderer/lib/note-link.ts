import { isAllowedNoteLink } from '../../shared/note-links'

export interface NoteLink {
  url: string
  name: string
  app: 'obsidian'
}

function unescapeHtml(str: string): string {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

/**
 * The note link a task offers to open. Anyone who may edit the task can write the marker, so only
 * the two shapes Vicu writes are offered (`isAllowedNoteLink`, description format "Task links");
 * any other `obsidian:` address gives no link. The marker itself stays in the description.
 */
export function extractNoteLink(description: string | undefined | null): NoteLink | null {
  if (!description) return null
  const match = description.match(/<!-- notelink:(obsidian:\/\/[^">\s]+) -->/)
  if (!match) return null
  const url = unescapeHtml(match[1])
  if (!isAllowedNoteLink(url)) return null
  const nameMatch = description.match(/\u{1F4CE}\s*([^<]+)<\/a>/u)
  const name = nameMatch ? nameMatch[1].trim() : 'Obsidian note'
  return { url, name, app: 'obsidian' }
}

/** Remove the notelink HTML comment + anchor tag from a description */
export function stripNoteLink(description: string | undefined | null): string {
  if (!description) return ''
  return description
    .replace(/<!-- notelink:obsidian:\/\/[^>]+ -->/, '')
    .replace(/<p><a href="obsidian:\/\/[^"]*">\u{1F4CE}\s*[^<]*<\/a><\/p>/u, '')
    .trim()
}

/** Extract just the raw notelink HTML portion from a description */
export function extractNoteLinkHtml(description: string | undefined | null): string {
  if (!description) return ''
  const comment = description.match(/<!-- notelink:obsidian:\/\/[^>]+ -->/)
  const anchor = description.match(/<p><a href="obsidian:\/\/[^"]*">\u{1F4CE}\s*[^<]*<\/a><\/p>/u)
  return (comment?.[0] ?? '') + (anchor?.[0] ?? '')
}

export interface PageLink {
  url: string
  title: string
  app: 'browser'
}

export type TaskLink = (NoteLink & { kind: 'note' }) | (PageLink & { kind: 'page' })

export function extractPageLink(description: string | undefined | null): PageLink | null {
  if (!description) return null
  const match = description.match(/<!-- pagelink:(https?:\/\/[^">\s]+) -->/)
  if (!match) return null
  const titleMatch = description.match(/\u{1F517}\s*([^<]+)<\/a>/u)
  const title = titleMatch ? titleMatch[1].trim() : match[1]
  return { url: unescapeHtml(match[1]), title, app: 'browser' }
}

export function extractTaskLink(description: string | undefined | null): TaskLink | null {
  const noteLink = extractNoteLink(description)
  if (noteLink) return { ...noteLink, kind: 'note' }
  const pageLink = extractPageLink(description)
  if (pageLink) return { ...pageLink, kind: 'page' }
  return null
}

export function stripPageLink(description: string | undefined | null): string {
  if (!description) return ''
  return description
    .replace(/<!-- pagelink:https?:\/\/[^>]+ -->/, '')
    .replace(/<p><a href="https?:\/\/[^"]*">\u{1F517}\s*[^<]*<\/a><\/p>/u, '')
    .trim()
}

export function extractPageLinkHtml(description: string | undefined | null): string {
  if (!description) return ''
  const comment = description.match(/<!-- pagelink:https?:\/\/[^>]+ -->/)
  const anchor = description.match(/<p><a href="https?:\/\/[^"]*">\u{1F517}\s*[^<]*<\/a><\/p>/u)
  return (comment?.[0] ?? '') + (anchor?.[0] ?? '')
}

/** Whether the description contains real notes content beyond an embedded note/page link. */
export function hasNotesContent(description: string | undefined | null): boolean {
  if (!description) return false
  const stripped = stripPageLink(stripNoteLink(description))
  return stripped.replace(/<[^>]+>/g, '').replace(/\s|&nbsp;/g, '').length > 0
}

const ENTITIES: Record<string, string> = { nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }

/** `&amp;` is decoded in the same pass as the others, so `&amp;lt;` stays the text `&lt;`. */
function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(nbsp|lt|gt|quot|apos|amp));/gi, (whole, dec, hex, name) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? whole
    const code = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16)
    return code > 0 && code <= 0xffff ? String.fromCharCode(code) : whole
  })
}

/**
 * The notes as one line of plain text, for a Comfortable row (design-system section 4): no link
 * markers and images, line breaks as spaces. Empty when no text is left. The same as the phone's
 * `TaskLinkParser.notesPreview`.
 */
export function notesPreview(description: string | undefined | null): string {
  if (!description) return ''
  const text = stripPageLink(stripNoteLink(description))
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\[\[image(-pending)?:[^\]]*]]/g, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|div|h[1-6]|blockquote|pre)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(text).replace(/\s+/g, ' ').trim()
}
