import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activeLists,
  appListToWire,
  compareRevision,
  documentFromLists,
  encodeCustomListEnvelope,
  hasVicuMetadataMarker,
  mergeCustomListDocuments,
  nextRevision,
  normalizeDocument,
  normalizeWireList,
  parseCustomListEnvelope,
  wireToAppList,
  type AppCustomList,
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

describe('include_overdue', () => {
  it('stays absent when nobody set it, so lists are not rewritten on load', () => {
    const normalized = normalizeWireList(list('a'))
    expect('include_overdue' in normalized.filter).toBe(false)
    // The fixture's populated list has no flag either, and normalizing leaves it that way.
    for (const record of Object.values(fixtures.populated.lists)) {
      expect('include_overdue' in normalizeWireList(record.value!).filter).toBe(false)
    }
  })

  it('does not change the shared fixtures when they are normalized, so nothing is rewritten on load', () => {
    for (const document of [fixtures.populated, fixtures.reordered]) {
      const normalized = normalizeDocument(document)
      for (const [id, record] of Object.entries(document.lists)) {
        expect(normalized.lists[id].value).toEqual(record.value)
      }
      expect(JSON.stringify(normalizeDocument(normalized))).toBe(JSON.stringify(normalized))
    }
  })

  it('keeps an explicit true or false and drops anything that is not a boolean', () => {
    const withFlag = (value: unknown) => normalizeWireList({ ...list('a'), filter: { ...list('a').filter, include_overdue: value as boolean } })
    expect(withFlag(false).filter.include_overdue).toBe(false)
    expect(withFlag(true).filter.include_overdue).toBe(true)
    expect('include_overdue' in withFlag('yes').filter).toBe(false)
    expect('include_overdue' in withFlag(undefined).filter).toBe(false)
    expect('include_overdue' in withFlag(null).filter).toBe(false)
  })

  it('survives the envelope and a merge', () => {
    const lists = [{ ...list('a'), filter: { ...list('a').filter, include_overdue: false } }]
    const left = documentFromLists(lists, 'desktop', 100)
    const parsed = parseCustomListEnvelope(encodeCustomListEnvelope(left)).document!
    expect(activeLists(parsed)[0].filter.include_overdue).toBe(false)
    const merged = mergeCustomListDocuments(parsed, documentFromLists([list('b')], 'android', 50))
    expect(activeLists(merged).find((entry) => entry.id === 'a')!.filter.include_overdue).toBe(false)
  })
})

describe('unknown fields from a newer app', () => {
  const withUnknown = (): CustomListWire => ({
    ...list('a', 'Focus'),
    color: '#ff8800',
    filter: {
      ...list('a').filter,
      include_overdue: false,
      due_in_days: 3,
      future_options: { nested: [1, 2, { deep: true }] },
    },
  })

  it('keeps them in list values and filters when normalizing', () => {
    const normalized = normalizeWireList(withUnknown())
    expect(normalized.color).toBe('#ff8800')
    expect(normalized.filter.due_in_days).toBe(3)
    expect(normalized.filter.future_options).toEqual({ nested: [1, 2, { deep: true }] })
    // Known fields are still normalized.
    expect(normalized.filter.priority_filter).toEqual([])
    expect(normalized.name).toBe('Focus')
  })

  it('does not let an unknown field shadow a known one', () => {
    const normalized = normalizeWireList({ ...list('a'), filter: { ...list('a').filter, due_date_filter: '' } })
    expect(normalized.filter.due_date_filter).toBe('all')
  })

  it('is idempotent and independent of the key order they arrived in', () => {
    const once = normalizeWireList(withUnknown())
    expect(JSON.stringify(normalizeWireList(once))).toBe(JSON.stringify(once))
    const reordered: CustomListWire = {
      color: '#ff8800',
      ...list('a', 'Focus'),
      filter: { future_options: withUnknown().filter.future_options, due_in_days: 3, ...list('a').filter, include_overdue: false },
    }
    expect(JSON.stringify(normalizeWireList(reordered))).toBe(JSON.stringify(once))
  })

  it('round-trips through the envelope and a merge with another device', () => {
    const left = documentFromLists([withUnknown()], 'android', 100)
    const parsed = parseCustomListEnvelope(encodeCustomListEnvelope(left)).document!
    const merged = mergeCustomListDocuments(documentFromLists([list('b')], 'desktop', 50), parsed)
    const survivor = activeLists(merged).find((entry) => entry.id === 'a')!
    expect(survivor.color).toBe('#ff8800')
    expect(survivor.filter.due_in_days).toBe(3)
    expect(survivor.filter.future_options).toEqual({ nested: [1, 2, { deep: true }] })
    expect(survivor.filter.include_overdue).toBe(false)
  })

  it('keeps them through normalizeDocument, including the record-level revision', () => {
    const document = documentFromLists([withUnknown()], 'android', 100)
    const normalized = normalizeDocument(document)
    expect(normalized.lists.a.value!.filter.due_in_days).toBe(3)
    expect(normalized.lists.a.revision).toEqual(document.lists.a.revision)
  })

  it('keeps them between the synced value and the list the app stores in its config', () => {
    const stored = wireToAppList(normalizeWireList(withUnknown()))
    expect(stored.color).toBe('#ff8800')
    expect(stored.filter.due_in_days).toBe(3)
    expect(stored.filter.include_overdue).toBe(false)

    // And back again: the config copy is a lossless cache the sync metadata can be rebuilt from.
    const rebuilt = appListToWire(stored)
    expect(rebuilt).toEqual(normalizeWireList(withUnknown()))
  })

  it('keeps a hand-written list from before the flag unchanged', () => {
    const legacy: AppCustomList = {
      id: 'old',
      name: 'Old list',
      filter: { project_ids: [3], sort_by: 'due_date', order_by: 'asc', due_date_filter: 'this_week', priority_filter: [4] },
    }
    const wire = appListToWire(legacy)
    expect('include_overdue' in wire.filter).toBe(false)
    expect(wireToAppList(wire)).toEqual({
      id: 'old',
      name: 'Old list',
      filter: {
        project_ids: [3],
        project_filter_mode: 'include',
        add_to_project_id: 0,
        sort_by: 'due_date',
        order_by: 'asc',
        due_date_filter: 'this_week',
        priority_filter: [4],
        include_done: false,
        include_today_all_projects: false,
      },
    })
  })
})
