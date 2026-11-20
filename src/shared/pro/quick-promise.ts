/**
 * The promise Quick Entry adds to a new task (cross-app semantics 5.5 and 21.6): the person and
 * the direction, and what the text said about who it was promised to and when to check on it. The
 * window is not trusted with the record itself, so main builds it from checked parts here.
 *
 * Import-free, so every tsconfig can include it.
 */
export interface QuickPromiseExtra {
  /** Who it was promised to: a person's label id, or a name in words. */
  to?: { person?: number; text?: string } | null
  /** The local day to look at it again (YYYY-MM-DD). */
  check_on?: string | null
}

const LOCAL_DAY = /^\d{4}-\d{2}-\d{2}$/
const MAX_NAME = 120

const wholeAboveZero = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0

/** The record to write, or null when the person is not a label id. Anything else unreadable is left out. */
export function quickPromiseValue(person: unknown, mine: unknown, extra?: unknown): Record<string, unknown> | null {
  if (!wholeAboveZero(person)) return null
  const value: Record<string, unknown> = { dir: mine === true ? 'mine' : 'theirs', person }
  const more = extra && typeof extra === 'object' ? (extra as { to?: unknown; check_on?: unknown }) : {}
  const to = more.to && typeof more.to === 'object' ? (more.to as { person?: unknown; text?: unknown }) : null
  if (to && wholeAboveZero(to.person)) value.to = { person: to.person }
  else if (to && typeof to.text === 'string' && to.text.trim()) value.to = { text: to.text.trim().slice(0, MAX_NAME) }
  if (typeof more.check_on === 'string' && LOCAL_DAY.test(more.check_on)) value.check_on = more.check_on
  return value
}
