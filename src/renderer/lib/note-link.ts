export interface NoteLink {
  url: string
  name: string
  app: 'obsidian'
}

export function extractNoteLink(description: string | undefined | null): NoteLink | null {
  if (!description) return null
  const match = description.match(/<!-- notelink:(obsidian:\/\/[^">\s]+) -->/)
  if (!match) return null
  const nameMatch = description.match(/\u{1F4CE}\s*([^<]+)<\/a>/u)
  const name = nameMatch ? nameMatch[1].trim() : 'Obsidian note'
  return { url: match[1], name, app: 'obsidian' }
}
