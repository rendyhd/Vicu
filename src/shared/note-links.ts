/**
 * Which note link of a task may be opened (docs/description-format-v1.md, "Task links"; vectors
 * `noteLinks` of test-fixtures/description-format-v1.json; Android: `util/NoteLinks.kt`).
 *
 * A task's `notelink` marker can be written by anyone who may edit the task, and an `obsidian:`
 * address can do more than open a note: with the Advanced URI plugin it runs commands and writes
 * files. So only the two shapes Vicu writes itself are offered: `obsidian://open` with `vault` and
 * `file`, and `obsidian://advanced-uri` with `vault` and `uid`. The test is on the text, not on a
 * parsed URL, so every platform decides the same way.
 *
 * Import-free on purpose, so every tsconfig can include it.
 */

/** The longest note link that is offered. */
export const NOTE_LINK_MAX_CHARS = 2048

const NOTE_LINK_PREFIX = 'obsidian://'
/** The parameter each allowed action takes next to `vault`. */
const NOTE_LINK_ACTIONS: Readonly<Record<string, string>> = { open: 'file', 'advanced-uri': 'uid' }
// A fragment, a quote, an angle bracket, a space or a control character has no place in the address.
// eslint-disable-next-line no-control-regex
const NOTE_LINK_FORBIDDEN = /[\u0000- \u007f"<>#]/

/** True when `url` is a note link in one of the two shapes Vicu writes. */
export function isAllowedNoteLink(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > NOTE_LINK_MAX_CHARS) return false
  if (!url.startsWith(NOTE_LINK_PREFIX) || NOTE_LINK_FORBIDDEN.test(url)) return false

  const rest = url.slice(NOTE_LINK_PREFIX.length)
  const queryStart = rest.indexOf('?')
  if (queryStart < 0) return false
  const action = rest.slice(0, queryStart)
  const second = Object.prototype.hasOwnProperty.call(NOTE_LINK_ACTIONS, action) ? NOTE_LINK_ACTIONS[action] : null
  if (!second) return false

  const pairs = rest.slice(queryStart + 1).split('&')
  if (pairs.length !== 2) return false
  const values = new Map<string, string>()
  for (const pair of pairs) {
    const equals = pair.indexOf('=')
    if (equals <= 0) return false
    const name = pair.slice(0, equals)
    if (values.has(name)) return false
    values.set(name, pair.slice(equals + 1))
  }
  return values.has('vault') && (values.get(second) ?? '') !== ''
}
