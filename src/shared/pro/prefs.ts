/**
 * Pro's synced preference keys (docs/cross-app-semantics-v1.md section 11.3 and 21): project types
 * and statuses, label statuses and kinds, repeat rules. A value that does not have the shape reads as
 * the default and is kept unchanged (section 11.2).
 *
 * Only imports its siblings, so every tsconfig can include it.
 */

export const PROJECT_MODE_KEY_PREFIX = 'project_mode.'
export const PROJECT_STATUS_KEY_PREFIX = 'project_status.'
export const LABEL_STATUS_KEY_PREFIX = 'label_status.'
export const LABEL_KIND_KEY_PREFIX = 'label_kind.'
export const REPEAT_RULE_KEY_PREFIX = 'repeat_rule.'

/** Every key prefix Pro writes, for the main process's writable check. */
export const PRO_PREF_PREFIXES = [
  PROJECT_MODE_KEY_PREFIX,
  PROJECT_STATUS_KEY_PREFIX,
  LABEL_STATUS_KEY_PREFIX,
  LABEL_KIND_KEY_PREFIX,
  REPEAT_RULE_KEY_PREFIX,
] as const

/** `parallel` is the default and never written. */
export type ProjectMode = 'parallel' | 'sequential' | 'single'

export const projectModeKey = (projectId: number): string => `${PROJECT_MODE_KEY_PREFIX}${projectId}`
export const projectStatusKey = (projectId: number): string => `${PROJECT_STATUS_KEY_PREFIX}${projectId}`
export const labelStatusKey = (labelId: number): string => `${LABEL_STATUS_KEY_PREFIX}${labelId}`
export const labelKindKey = (labelId: number): string => `${LABEL_KIND_KEY_PREFIX}${labelId}`
export const repeatRuleKey = (taskId: number): string => `${REPEAT_RULE_KEY_PREFIX}${taskId}`

/** The id at the end of a Pro key, or null when the key is not one of `prefix`'s. */
export function idOfProKey(key: string, prefix: string): number | null {
  if (!key.startsWith(prefix)) return null
  const rest = key.slice(prefix.length)
  return /^[1-9]\d*$/.test(rest) ? Number(rest) : null
}

/** Whether a key is one of Pro's (a whole number above 0 after the prefix). */
export function isProPrefKey(key: string): boolean {
  return PRO_PREF_PREFIXES.some((prefix) => idOfProKey(key, prefix) !== null)
}

export function readProjectMode(value: unknown): ProjectMode {
  return value === 'sequential' || value === 'single' ? value : 'parallel'
}

/** A project or a label is on hold only with the value `"on_hold"`. */
export function readOnHold(value: unknown): boolean {
  return value === 'on_hold'
}

export function readIsPerson(value: unknown): boolean {
  return value === 'person'
}

export function projectMode(values: Readonly<Record<string, unknown>>, projectId: number): ProjectMode {
  return readProjectMode(values[projectModeKey(projectId)])
}

export function projectOnHold(values: Readonly<Record<string, unknown>>, projectId: number): boolean {
  return readOnHold(values[projectStatusKey(projectId)])
}

export function labelOnHold(values: Readonly<Record<string, unknown>>, labelId: number): boolean {
  return readOnHold(values[labelStatusKey(labelId)])
}

export function isPersonLabel(values: Readonly<Record<string, unknown>>, labelId: number): boolean {
  return readIsPerson(values[labelKindKey(labelId)])
}

/** The label ids marked as a person. */
export function personLabelIds(values: Readonly<Record<string, unknown>>): Set<number> {
  const ids = new Set<number>()
  for (const [key, value] of Object.entries(values)) {
    const id = idOfProKey(key, LABEL_KIND_KEY_PREFIX)
    if (id !== null && readIsPerson(value)) ids.add(id)
  }
  return ids
}

/** The label ids on hold. */
export function onHoldLabelIds(values: Readonly<Record<string, unknown>>): Set<number> {
  const ids = new Set<number>()
  for (const [key, value] of Object.entries(values)) {
    const id = idOfProKey(key, LABEL_STATUS_KEY_PREFIX)
    if (id !== null && readOnHold(value)) ids.add(id)
  }
  return ids
}

// --- Repeat rules (section 21.13) --------------------------------------------------------------

export interface RepeatRule {
  /** The last local day an occurrence may be due on. */
  until?: string
  /** Occurrences left, this one included. */
  count?: number
  /** After a completion, move an occurrence that is still in the past to the first one from today. */
  catch_up?: boolean
  [unknownField: string]: unknown
}

/** A stored repeat rule, or null when it has none of the three (or is not an object). */
export function readRepeatRule(value: unknown): RepeatRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const stored = value as Record<string, unknown>
  const rule: RepeatRule = { ...stored }
  delete rule.until
  delete rule.count
  delete rule.catch_up
  let any = false
  if (typeof stored.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(stored.until)) {
    rule.until = stored.until
    any = true
  }
  if (typeof stored.count === 'number' && Number.isInteger(stored.count) && stored.count >= 1) {
    rule.count = stored.count
    any = true
  }
  if (stored.catch_up === true) {
    rule.catch_up = true
    any = true
  }
  return any ? rule : null
}
