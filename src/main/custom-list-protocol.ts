export const CUSTOM_LIST_CARRIER_TITLE = 'Vicu custom lists (sync metadata — do not delete)'
export const CUSTOM_LIST_MARKER_PREFIX = '<!-- vicu-custom-lists:'
export const CUSTOM_LIST_SYNC_VERSION = 1
export const CUSTOM_LIST_SYNC_MAX_BYTES = 512 * 1024

const MARKER_RE = /<!--\s*vicu-custom-lists:v(\d+):([A-Za-z0-9_-]+={0,2})\s*-->/
const ANY_MARKER_RE = /<!--\s*vicu-custom-lists:[\s\S]*?-->/

export interface CustomListWireFilter {
  project_ids: number[]
  project_filter_mode: 'include' | 'exclude'
  add_to_project_id: number
  sort_by: string
  order_by: string
  due_date_filter: string
  priority_filter: number[]
  label_ids: number[]
  include_done: boolean
  include_today_all_projects: boolean
}

export interface CustomListWire {
  id: string
  name: string
  icon: string
  filter: CustomListWireFilter
}

export interface CustomListRevision {
  wall_time_ms: number
  counter: number
  device_id: string
}

export interface CustomListSyncRecord {
  value: CustomListWire | null
  revision: CustomListRevision
}

export interface CustomListSyncDocumentV1 {
  version: 1
  lists: Record<string, CustomListSyncRecord>
  order: { ids: string[]; revision: CustomListRevision }
}

export interface ParsedCustomListEnvelope {
  isCarrier: boolean
  body: string
  version?: number
  document?: CustomListSyncDocumentV1
  error?: string
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function hasCustomListMarker(description?: string | null): boolean {
  return !!description && ANY_MARKER_RE.test(description)
}

export function hasVicuMetadataMarker(description?: string | null): boolean {
  return !!description && (
    /<!--\s*vicu-routine:[\s\S]*?-->/.test(description) || hasCustomListMarker(description)
  )
}

export function compareRevision(left: CustomListRevision, right: CustomListRevision): number {
  return left.wall_time_ms - right.wall_time_ms ||
    left.counter - right.counter ||
    compareStrings(left.device_id, right.device_id)
}

function allRevisions(document: CustomListSyncDocumentV1): CustomListRevision[] {
  return [document.order.revision, ...Object.values(document.lists).map((entry) => entry.revision)]
}

export function nextRevision(
  document: CustomListSyncDocumentV1,
  deviceId: string,
  now = Date.now(),
): CustomListRevision {
  const revisions = allRevisions(document)
  const maxWall = revisions.reduce((max, revision) => Math.max(max, revision.wall_time_ms), 0)
  const wallTime = Math.max(now, maxWall)
  const maxCounter = revisions
    .filter((revision) => revision.wall_time_ms === wallTime)
    .reduce((max, revision) => Math.max(max, revision.counter), -1)
  return {
    wall_time_ms: wallTime,
    counter: wallTime === now && now > maxWall ? 0 : maxCounter + 1,
    device_id: deviceId,
  }
}

export function emptyCustomListDocument(deviceId: string, now = Date.now()): CustomListSyncDocumentV1 {
  return {
    version: 1,
    lists: {},
    order: { ids: [], revision: { wall_time_ms: now, counter: 0, device_id: deviceId } },
  }
}

export function normalizeWireList(value: CustomListWire): CustomListWire {
  return {
    id: value.id,
    name: value.name.trim(),
    icon: value.icon || '',
    filter: {
      project_ids: [...new Set(value.filter.project_ids ?? [])],
      project_filter_mode: value.filter.project_filter_mode === 'exclude' ? 'exclude' : 'include',
      add_to_project_id: Number.isFinite(value.filter.add_to_project_id) ? value.filter.add_to_project_id : 0,
      sort_by: value.filter.sort_by || 'due_date',
      order_by: value.filter.order_by === 'desc' ? 'desc' : 'asc',
      due_date_filter: value.filter.due_date_filter || 'all',
      priority_filter: [...new Set(value.filter.priority_filter ?? [])],
      label_ids: [...new Set(value.filter.label_ids ?? [])],
      include_done: value.filter.include_done === true,
      include_today_all_projects: value.filter.include_today_all_projects === true,
    },
  }
}

export function documentFromLists(
  lists: CustomListWire[],
  deviceId: string,
  now = Date.now(),
): CustomListSyncDocumentV1 {
  const document = emptyCustomListDocument(deviceId, now)
  let counter = 0
  for (const value of lists) {
    const normalized = normalizeWireList(value)
    document.lists[normalized.id] = {
      value: normalized,
      revision: { wall_time_ms: now, counter: counter++, device_id: deviceId },
    }
  }
  document.order = {
    ids: lists.map((list) => list.id),
    revision: { wall_time_ms: now, counter, device_id: deviceId },
  }
  return document
}

export function activeLists(document: CustomListSyncDocumentV1): CustomListWire[] {
  const active = Object.values(document.lists).filter(
    (record): record is CustomListSyncRecord & { value: CustomListWire } => record.value !== null,
  )
  const byId = new Map(active.map((record) => [record.value.id, record]))
  const result: CustomListWire[] = []
  const seen = new Set<string>()
  for (const id of document.order.ids) {
    const record = byId.get(id)
    if (!record || seen.has(id)) continue
    seen.add(id)
    result.push(normalizeWireList(record.value))
  }
  const missing = active
    .filter((record) => !seen.has(record.value.id))
    .sort((left, right) => compareRevision(left.revision, right.revision) || compareStrings(left.value.id, right.value.id))
  return [...result, ...missing.map((record) => normalizeWireList(record.value))]
}

export function normalizeDocument(document: CustomListSyncDocumentV1): CustomListSyncDocumentV1 {
  const lists: Record<string, CustomListSyncRecord> = {}
  for (const [id, record] of Object.entries(document.lists)) {
    lists[id] = { ...record, value: record.value ? normalizeWireList({ ...record.value, id }) : null }
  }
  const normalized: CustomListSyncDocumentV1 = { version: 1, lists, order: { ...document.order, ids: [...document.order.ids] } }
  normalized.order.ids = activeLists(normalized).map((list) => list.id)
  return normalized
}

export function mergeCustomListDocuments(
  left: CustomListSyncDocumentV1,
  right: CustomListSyncDocumentV1,
): CustomListSyncDocumentV1 {
  const lists: Record<string, CustomListSyncRecord> = {}
  for (const id of new Set([...Object.keys(left.lists), ...Object.keys(right.lists)])) {
    const a = left.lists[id]
    const b = right.lists[id]
    lists[id] = !a ? b : !b ? a : compareRevision(a.revision, b.revision) >= 0 ? a : b
  }
  const order = compareRevision(left.order.revision, right.order.revision) >= 0 ? left.order : right.order
  return normalizeDocument({ version: 1, lists, order: { ids: [...order.ids], revision: { ...order.revision } } })
}

function validateRevision(value: unknown): asserts value is CustomListRevision {
  if (!value || typeof value !== 'object') throw new Error('Custom-list revision is missing')
  const revision = value as Partial<CustomListRevision>
  if (!Number.isFinite(revision.wall_time_ms) || !Number.isInteger(revision.counter) || revision.counter! < 0 || !revision.device_id) {
    throw new Error('Custom-list revision is invalid')
  }
}

export function validateCustomListDocument(value: unknown): asserts value is CustomListSyncDocumentV1 {
  if (!value || typeof value !== 'object') throw new Error('Custom-list metadata is invalid')
  const document = value as Partial<CustomListSyncDocumentV1>
  if (document.version !== 1) throw new Error('Custom-list payload version mismatch')
  if (!document.lists || typeof document.lists !== 'object' || !document.order || !Array.isArray(document.order.ids)) {
    throw new Error('Custom-list metadata structure is invalid')
  }
  validateRevision(document.order.revision)
  for (const [id, record] of Object.entries(document.lists)) {
    if (!record || typeof record !== 'object') throw new Error(`Custom-list record ${id} is invalid`)
    const typed = record as Partial<CustomListSyncRecord>
    validateRevision(typed.revision)
    if (typed.value !== null) {
      if (!typed.value || typed.value.id !== id || !typed.value.name?.trim() || !typed.value.filter) {
        throw new Error(`Custom-list value ${id} is invalid`)
      }
      normalizeWireList(typed.value)
    }
  }
}

export function parseCustomListEnvelope(description?: string | null): ParsedCustomListEnvelope {
  if (!description) return { isCarrier: false, body: '' }
  const any = description.match(ANY_MARKER_RE)
  if (!any || any.index === undefined) return { isCarrier: false, body: description }
  const body = `${description.slice(0, any.index)}${description.slice(any.index + any[0].length)}`.trimEnd()
  const marker = any[0].match(MARKER_RE)
  if (!marker) return { isCarrier: true, body, error: 'Malformed custom-list metadata' }
  const version = Number(marker[1])
  if (version !== CUSTOM_LIST_SYNC_VERSION) {
    return { isCarrier: true, body, version, error: `Custom-list metadata version ${version} is not supported` }
  }
  try {
    const bytes = Buffer.from(marker[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    if (bytes.byteLength > CUSTOM_LIST_SYNC_MAX_BYTES) throw new Error('Custom-list metadata is too large')
    const document = JSON.parse(bytes.toString('utf8')) as unknown
    validateCustomListDocument(document)
    return { isCarrier: true, body, version, document: normalizeDocument(document) }
  } catch (error) {
    return { isCarrier: true, body, version, error: error instanceof Error ? error.message : 'Cannot decode custom-list metadata' }
  }
}

export function encodeCustomListEnvelope(document: CustomListSyncDocumentV1): string {
  validateCustomListDocument(document)
  const bytes = Buffer.from(JSON.stringify(normalizeDocument(document)), 'utf8')
  if (bytes.byteLength > CUSTOM_LIST_SYNC_MAX_BYTES) throw new Error('Custom-list metadata is too large')
  return `<!-- vicu-custom-lists:v1:${bytes.toString('base64url')} -->`
}
