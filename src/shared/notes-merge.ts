/**
 * Notes changed in two places (docs/description-format-v1.md, "Synchronization"; vectors
 * `notesConflict` of test-fixtures/description-format-v1.json; Android: `util/NotesMerge.kt`).
 *
 * A notes edit remembers the description it started from (the base). Before it is sent, the task is
 * read: when the server still holds the base, the edit is sent; when the server holds something
 * else, both versions are kept, the server's first, then a divider, then this device's. Nothing is
 * ever dropped, and no question is asked, because a queued edit is sent when nobody is looking.
 *
 * Works on the stored text only (no HTML parser), so every platform gives the same result.
 * Import-free on purpose, so every tsconfig can include it.
 */

export type NotesSaveDecision =
  /** Nothing was changed, or the server's notes already hold all of this device's: no description is sent. */
  | { action: 'nothing' }
  /** The server still holds the base: the edit is sent as it is. */
  | { action: 'send'; description: string }
  /** Both sides changed: this merged description is sent instead. */
  | { action: 'merge'; description: string }

/** The divider between the two versions of merged notes. */
export const NOTES_MERGE_DIVIDER = '<hr>'

const LINK_PAIR =
  /<!-- (?:notelink:obsidian|pagelink:https?):\/\/[^>]+ -->(?:<p><a href="[^"]*">[^<]*<\/a><\/p>)?/g
const TOKEN_LINE = /^\[\[image(?:-pending)?:[^\]\n]*\]\]$/

interface NotesParts {
  body: string
  /** Image tokens that stand on a line of their own, in order. */
  tokens: string[]
  /** The notelink and pagelink pairs, as stored. */
  links: string[]
}

const text = (value: string | null | undefined): string => (typeof value === 'string' ? value : '')

/** Space, tab and line ends off both ends (named, so no platform's own trim can differ). */
const trimmed = (value: string): string => value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')

/** A description taken apart: the pairs and the token lines leave, the rest is the body. */
function splitNotes(description: string): NotesParts {
  const links: string[] = []
  const withoutLinks = description.replace(LINK_PAIR, (pair) => {
    links.push(pair)
    return ''
  })
  const tokens: string[] = []
  const bodyLines: string[] = []
  for (const line of withoutLinks.split('\n')) {
    const token = trimmed(line)
    if (TOKEN_LINE.test(token)) tokens.push(token)
    else bodyLines.push(line)
  }
  return { body: trimmed(bodyLines.join('\n')), tokens, links }
}

/** The parts put together again: body, one token a line, then the pairs. */
function joinNotes(parts: NotesParts): string {
  return [parts.body, ...parts.tokens, parts.links.join('')].filter((part) => part !== '').join('\n')
}

/**
 * Both versions in one description: the server's body, the divider, this device's body (one body
 * when they are the same, one is empty, or the server's already ends with the divider and this
 * device's); the server's token lines, then this device's that the
 * server lacks; the link pairs the same way.
 */
export function mergeNotes(server: string | null | undefined, local: string | null | undefined): string {
  const theirs = splitNotes(text(server))
  const mine = splitNotes(text(local))
  const body =
    // The last case: an earlier send of these merged notes arrived, and only its answer was lost.
    theirs.body === mine.body || mine.body === '' || theirs.body.endsWith(NOTES_MERGE_DIVIDER + mine.body)
      ? theirs.body
      : theirs.body === ''
        ? mine.body
        : `${theirs.body}${NOTES_MERGE_DIVIDER}${mine.body}`
  const tokens = [...theirs.tokens, ...mine.tokens.filter((token) => !theirs.tokens.includes(token))]
  const links = [...theirs.links, ...mine.links.filter((link) => !theirs.links.includes(link))]
  return joinNotes({ body, tokens, links })
}

/**
 * What a notes edit sends. `base` is the description the edit started from, `local` what the user
 * wants saved, `server` the description just read. Compared as stored text with the space, tabs and
 * line ends at both ends left out; nothing else is normalised.
 */
export function decideNotesSave(
  base: string | null | undefined,
  local: string | null | undefined,
  server: string | null | undefined,
): NotesSaveDecision {
  const from = trimmed(text(base))
  const mine = trimmed(text(local))
  const theirs = trimmed(text(server))
  if (mine === theirs || mine === from) return { action: 'nothing' }
  if (theirs === from) return { action: 'send', description: text(local) }
  const merged = mergeNotes(theirs, mine)
  // Nothing of this device's is missing from the server's notes: it only took text away.
  if (merged === theirs) return { action: 'nothing' }
  // Nothing of the server's is missing from this device's notes: the server only took text away.
  if (merged === mine) return { action: 'send', description: text(local) }
  return { action: 'merge', description: merged }
}
