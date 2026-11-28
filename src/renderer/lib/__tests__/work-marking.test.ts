import { describe, expect, it } from 'vitest'
import { workMarkWrite } from '../work-marking'

const work = new Set([10, 11])
const isWork = (id: number) => work.has(id)

describe('workMarkWrite', () => {
  it('writes true for a top-level project marked as work', () => {
    expect(workMarkWrite({ id: 5, parent_project_id: 0 }, true, isWork)).toEqual({ 'work.project.5': true })
  })

  it('clears the entry of a top-level project marked as not work', () => {
    expect(workMarkWrite({ id: 5 }, false, isWork)).toEqual({ 'work.project.5': null })
  })

  it('clears the entry when the parent is work and the person wants work', () => {
    expect(workMarkWrite({ id: 11, parent_project_id: 10 }, true, isWork)).toEqual({ 'work.project.11': null })
  })

  it('writes false to take a subproject out of a work parent', () => {
    expect(workMarkWrite({ id: 11, parent_project_id: 10 }, false, isWork)).toEqual({ 'work.project.11': false })
  })

  it('writes true under a parent that is not work', () => {
    expect(workMarkWrite({ id: 6, parent_project_id: 5 }, true, isWork)).toEqual({ 'work.project.6': true })
  })
})
