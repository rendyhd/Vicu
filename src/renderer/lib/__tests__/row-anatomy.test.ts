import { describe, expect, it } from 'vitest'
import { checklistLabel, NO_ROW_VIEW, rowLabels, rowProjectSource } from '../row-anatomy'

describe('rowProjectSource', () => {
  it('shows nothing where the list does not mix projects and no group passed one', () => {
    expect(rowProjectSource(5, NO_ROW_VIEW, false)).toBe('none')
  })

  it('takes the project a group of one passes down', () => {
    expect(rowProjectSource(5, NO_ROW_VIEW, true)).toBe('group')
  })

  it('looks the project up in a list that mixes projects', () => {
    expect(rowProjectSource(5, { showProject: true }, false)).toBe('lookup')
    expect(rowProjectSource(5, { showProject: true }, true)).toBe('group')
  })

  it('never names a project inside its own project', () => {
    expect(rowProjectSource(5, { projectId: 5 }, true)).toBe('none')
    expect(rowProjectSource(5, { projectId: 5, showProject: true }, false)).toBe('none')
    expect(rowProjectSource(6, { projectId: 5, showProject: true }, false)).toBe('lookup')
  })
})

describe('rowLabels', () => {
  const labels = [{ id: 1 }, { id: 2 }, { id: 3 }]

  it('keeps every label outside a Tag view', () => {
    expect(rowLabels(labels, NO_ROW_VIEW)).toEqual(labels)
  })

  it('drops the label a Tag view is about', () => {
    expect(rowLabels(labels, { labelId: 2 })).toEqual([{ id: 1 }, { id: 3 }])
    expect(rowLabels([{ id: 2 }], { labelId: 2 })).toEqual([])
  })
})

describe('checklistLabel', () => {
  it('reads "1 of 3"', () => {
    expect(checklistLabel(1, 3)).toBe('1 of 3')
  })
})
