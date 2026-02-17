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
