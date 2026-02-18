export interface NoteLink {
  url: string
  name: string
  app: 'obsidian'
}

function unescapeHtml(str: string): string {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

export function extractNoteLink(description: string | undefined | null): NoteLink | null {
  if (!description) return null
  const match = description.match(/<!-- notelink:(obsidian:\/\/[^">\s]+) -->/)
  if (!match) return null
  const nameMatch = description.match(/\u{1F4CE}\s*([^<]+)<\/a>/u)
  const name = nameMatch ? nameMatch[1].trim() : 'Obsidian note'
  return { url: unescapeHtml(match[1]), name, app: 'obsidian' }
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
