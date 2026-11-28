import type { ApiResult } from './api-result'
import { labelForNewPerson, newPersonTitle } from '../shared/pro/people'
import { labelKindKey } from '../shared/pro/prefs'

/**
 * Making a person from quick add (cross-app semantics 21.5, `$Lalith` in 5.5): the label with that
 * title becomes the person, else a label is created; then `label_kind.<id>` is set to "person". Both
 * windows (the composer and Quick Entry) call it through `pro:ensure-person`. Needs the server: a
 * failure is answered as it came, and the caller keeps the `$` phrase in the title.
 */

export interface EnsuredPerson {
  id: number
  title: string
  /** A new label was made for the person. */
  created: boolean
  /** The label as the server answered it. */
  label: Record<string, unknown>
}

export interface EnsurePersonDeps {
  fetchLabels(): Promise<ApiResult<unknown[]>>
  createLabel(label: Record<string, unknown>): Promise<ApiResult<unknown>>
  /** Writes the synced preferences (one change). */
  setPrefs(values: Record<string, unknown>): void
}

const MAX_NAME_LENGTH = 250

type ListedLabel = { id: number; title: string; label: Record<string, unknown> }

function readLabel(value: unknown): ListedLabel | null {
  if (!value || typeof value !== 'object') return null
  const label = value as Record<string, unknown>
  const { id, title } = label
  return typeof id === 'number' && Number.isInteger(id) && id > 0 && typeof title === 'string' ? { id, title, label } : null
}

export async function ensurePerson(name: unknown, deps: EnsurePersonDeps): Promise<ApiResult<EnsuredPerson>> {
  const title = typeof name === 'string' ? newPersonTitle(name) : ''
  if (!title || title.length > MAX_NAME_LENGTH) return { success: false, error: 'Invalid person name' }
  const listed = await deps.fetchLabels()
  if (!listed.success) return listed
  const labels = listed.data.map(readLabel).filter((label): label is ListedLabel => label !== null)
  const existing = labelForNewPerson(labels, title)
  let person: EnsuredPerson
  if (existing !== null) {
    const found = labels.find((label) => label.id === existing)!
    person = { id: found.id, title: found.title, created: false, label: found.label }
  } else {
    const made = await deps.createLabel({ title })
    if (!made.success) return made
    const label = readLabel(made.data)
    if (!label) return { success: false, error: 'The server did not return the new label' }
    person = { id: label.id, title: label.title, created: true, label: label.label }
  }
  deps.setPrefs({ [labelKindKey(person.id)]: 'person' })
  return { success: true, data: person }
}
