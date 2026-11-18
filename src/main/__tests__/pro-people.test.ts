import { describe, expect, it, vi } from 'vitest'
import { ensurePerson, type EnsurePersonDeps } from '../pro-people'
import { labelForNewPerson } from '../../shared/pro/people'

function deps(labels: unknown[], made: unknown = { id: 99, title: 'Lalith', hex_color: 'e8e8e8' }) {
  return {
    fetchLabels: vi.fn<EnsurePersonDeps['fetchLabels']>(async () => ({ success: true as const, data: labels })),
    createLabel: vi.fn<EnsurePersonDeps['createLabel']>(async () => ({ success: true as const, data: made })),
    setPrefs: vi.fn<EnsurePersonDeps['setPrefs']>(),
  }
}

describe('labelForNewPerson (cross-app semantics 21.5)', () => {
  it('finds the label by title, spacing and case ignored, the lowest id first', () => {
    const labels = [{ id: 9, title: 'lalith' }, { id: 4, title: ' Lalith ' }, { id: 2, title: 'Work' }]
    expect(labelForNewPerson(labels, 'LALITH')).toBe(4)
    expect(labelForNewPerson(labels, 'Lalith  Kumar')).toBeNull()
    expect(labelForNewPerson(labels, '  ')).toBeNull()
  })
})

describe('ensurePerson', () => {
  it('marks an existing label with that name as a person, without making one', async () => {
    const d = deps([{ id: 7, title: 'Lalith' }, { id: 3, title: 'Work' }])
    const result = await ensurePerson('lalith', d)
    expect(result).toMatchObject({ success: true, data: { id: 7, title: 'Lalith', created: false } })
    expect(d.createLabel).not.toHaveBeenCalled()
    expect(d.setPrefs).toHaveBeenCalledWith({ 'label_kind.7': 'person' })
  })

  it('makes a label with the name as written when none matches', async () => {
    const d = deps([{ id: 3, title: 'Work' }], { id: 99, title: 'Lalith Kumar' })
    const result = await ensurePerson('  Lalith   Kumar ', d)
    expect(d.createLabel).toHaveBeenCalledWith({ title: 'Lalith Kumar' })
    expect(result).toMatchObject({ success: true, data: { id: 99, title: 'Lalith Kumar', created: true } })
    expect(d.setPrefs).toHaveBeenCalledWith({ 'label_kind.99': 'person' })
  })

  it('passes a failure on and marks nothing', async () => {
    const d = deps([])
    d.fetchLabels = vi.fn(async () => ({ success: false as const, error: 'offline' }))
    expect(await ensurePerson('Lalith', d)).toEqual({ success: false, error: 'offline' })
    expect(d.setPrefs).not.toHaveBeenCalled()

    const refused = deps([])
    refused.createLabel.mockResolvedValue({ success: false, error: 'forbidden', statusCode: 403 })
    expect(await ensurePerson('Lalith', refused)).toMatchObject({ success: false, error: 'forbidden' })
    expect(refused.setPrefs).not.toHaveBeenCalled()
  })

  it('refuses an empty name or an answer without a label', async () => {
    expect(await ensurePerson('   ', deps([]))).toMatchObject({ success: false })
    expect(await ensurePerson(42, deps([]))).toMatchObject({ success: false })
    expect(await ensurePerson('Lalith', deps([], { nope: true }))).toMatchObject({ success: false })
  })
})
