import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activeLists,
  compareRevision,
  documentFromLists,
  encodeCustomListEnvelope,
  hasVicuMetadataMarker,
  mergeCustomListDocuments,
  nextRevision,
  parseCustomListEnvelope,
  type CustomListSyncDocumentV1,
  type CustomListWire,
} from '../custom-list-protocol'

interface FixtureCorpus {
  empty: CustomListSyncDocumentV1
  populated: CustomListSyncDocumentV1
  deleted: CustomListSyncDocumentV1
  reordered: CustomListSyncDocumentV1
  malformed: string
  concurrent: {
    left_revision: { wall_time_ms: number; counter: number; device_id: string }
    right_revision: { wall_time_ms: number; counter: number; device_id: string }
    winner_device_id: string
  }
}

const fixtures = JSON.parse(readFileSync(
  join(process.cwd(), 'test-fixtures', 'custom-list-sync-v1.json'),
  'utf8',
)) as FixtureCorpus

const list = (id: string, name = id): CustomListWire => ({
  id,
  name,
  icon: '',
  filter: {
    project_ids: [],
    project_filter_mode: 'include',
    add_to_project_id: 0,
    sort_by: 'due_date',
    order_by: 'asc',
    due_date_filter: 'all',
    priority_filter: [],
    label_ids: [],
    include_done: false,
    include_today_all_projects: false,
  },
})

describe('custom-list carrier protocol', () => {
  it('accepts the shared empty, populated, deleted, reordered, malformed, and concurrent fixtures', () => {
    expect(activeLists(fixtures.empty)).toEqual([])
    expect(activeLists(fixtures.populated).map((entry) => entry.id)).toEqual(['list-a'])
    expect(activeLists(fixtures.deleted)).toEqual([])
    expect(activeLists(fixtures.reordered).map((entry) => entry.id)).toEqual(['list-b', 'list-a'])
    expect(parseCustomListEnvelope(fixtures.malformed).error).toBeTruthy()
    const winner = compareRevision(fixtures.concurrent.left_revision, fixtures.concurrent.right_revision) >= 0
      ? fixtures.concurrent.left_revision
      : fixtures.concurrent.right_revision
    expect(winner.device_id).toBe(fixtures.concurrent.winner_device_id)
  })

  it('round-trips unicode through the versioned envelope', () => {
    const source = documentFromLists([list('a', 'Mañana 🗂️')], 'desktop', 100)
    const parsed = parseCustomListEnvelope(encodeCustomListEnvelope(source))
    expect(parsed.error).toBeUndefined()
    expect(activeLists(parsed.document!)[0].name).toBe('Mañana 🗂️')
  })

  it('recognizes all Vicu metadata carriers', () => {
    expect(hasVicuMetadataMarker('<!-- vicu-custom-lists:v1:e30 -->')).toBe(true)
    expect(hasVicuMetadataMarker('<!-- vicu-routine:v1:e30 -->')).toBe(true)
    expect(hasVicuMetadataMarker('ordinary notes')).toBe(false)
  })

  it('reports an unknown version without decoding it', () => {
    const parsed = parseCustomListEnvelope('<!-- vicu-custom-lists:v2:e30 -->')
    expect(parsed.isCarrier).toBe(true)
    expect(parsed.version).toBe(2)
    expect(parsed.document).toBeUndefined()
  })

  it('merges UUID-distinct lists without name deduplication', () => {
    const left = documentFromLists([list('a', 'Work')], 'desktop', 100)
    const right = documentFromLists([list('b', 'Work')], 'android', 101)
    expect(activeLists(mergeCustomListDocuments(left, right)).map((entry) => entry.id).sort()).toEqual(['a', 'b'])
  })

  it('uses the newest per-list revision and keeps tombstones', () => {
    const left = documentFromLists([list('a', 'Old')], 'desktop', 100)
    const right = structuredClone(left)
    right.lists.a = { value: null, revision: nextRevision(right, 'android', 200) }
    const merged = mergeCustomListDocuments(left, right)
    expect(activeLists(merged)).toEqual([])
    expect(merged.lists.a.value).toBeNull()
  })

  it('normalizes an order winner by appending missing active IDs', () => {
    const left = documentFromLists([list('a')], 'desktop', 100)
    const right = documentFromLists([list('b')], 'android', 200)
    const merged = mergeCustomListDocuments(left, right)
    expect(activeLists(merged).map((entry) => entry.id)).toEqual(['b', 'a'])
  })

  it('breaks equal-time revisions by counter then device id', () => {
    const base = documentFromLists([list('a')], 'desktop', 100)
    const left = structuredClone(base) as CustomListSyncDocumentV1
    const right = structuredClone(base) as CustomListSyncDocumentV1
    left.lists.a = { value: list('a', 'Desktop'), revision: { wall_time_ms: 500, counter: 1, device_id: 'desktop' } }
    right.lists.a = { value: list('a', 'Android'), revision: { wall_time_ms: 500, counter: 1, device_id: 'mobile' } }
    expect(activeLists(mergeCustomListDocuments(left, right))[0].name).toBe('Android')
  })
})
