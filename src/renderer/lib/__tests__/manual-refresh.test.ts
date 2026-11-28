import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { MANUAL_REFRESH_KEYS, isRefreshKey, manualRefresh } from '../manual-refresh'
import { DATE_QUERY_KEYS } from '../task-refresh'

vi.mock('../api', () => ({ api: {} }))

function setup(pending: number) {
  const qc = new QueryClient()
  const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
  const deps = { pendingCount: () => pending, replayNow: vi.fn(), syncDocuments: vi.fn(), refreshCalendars: vi.fn() }
  return { qc, invalidate, deps }
}

const invalidatedKeys = (spy: ReturnType<typeof setup>['invalidate']) =>
  spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey))

describe('manualRefresh (issue 38: F5 / Mod+R)', () => {
  it('rereads tasks, projects, labels and sharing, and syncs the synced documents', () => {
    const { qc, invalidate, deps } = setup(0)
    expect(manualRefresh(qc, deps)).toBe('refreshed')
    const keys = invalidatedKeys(invalidate)
    for (const key of [...MANUAL_REFRESH_KEYS, ...DATE_QUERY_KEYS]) expect(keys).toContain(JSON.stringify(key))
    expect(deps.syncDocuments).toHaveBeenCalledOnce()
    expect(deps.refreshCalendars).toHaveBeenCalledOnce()
    expect(deps.replayNow).not.toHaveBeenCalled()
  })

  it('asks for a replay instead of refetching tasks while changes are queued', () => {
    const { qc, invalidate, deps } = setup(2)
    expect(manualRefresh(qc, deps)).toBe('deferred')
    expect(deps.replayNow).toHaveBeenCalledOnce()
    expect(invalidatedKeys(invalidate)).not.toContain(JSON.stringify(['tasks']))
  })
})

describe('isRefreshKey', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) =>
    ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })

  it('is F5 without modifiers', () => {
    expect(isRefreshKey(key('F5'))).toBe(true)
    expect(isRefreshKey(key('F5', { ctrlKey: true }))).toBe(false)
    expect(isRefreshKey(key('r'))).toBe(false)
  })
})
