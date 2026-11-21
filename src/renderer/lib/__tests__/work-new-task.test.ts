import { describe, expect, it } from 'vitest'
import { workLabelForNewTask, newTaskStaysPersonal, type WorkScope } from '../../../shared/work-scope'
import { namedLabelIds, planNewTaskWork } from '../work-new-task'

const scope: WorkScope = { label: 7, projects: new Set([10]) }
const noLabel: WorkScope = { label: null, projects: new Set([10]) }

const planIn = (s: WorkScope, mode: 'all' | 'work' | 'personal', projectId: number, named: { id: number }[] = [], optOut = false) =>
  planNewTaskWork({
    projectId,
    named,
    optOut,
    labelForNewTask: (task) => workLabelForNewTask(task, s, mode),
    staysPersonal: (task) => newTaskStaysPersonal(task, s, mode),
  })

describe('planNewTaskWork', () => {
  it('adds the work label in Work for a task outside a work project', () => {
    expect(planIn(scope, 'work', 3)).toEqual({ labelId: 7, staysPersonal: false })
  })

  it('adds nothing in a work project or when the task names the label', () => {
    expect(planIn(scope, 'work', 10).labelId).toBeNull()
    expect(planIn(scope, 'work', 3, [{ id: 7 }]).labelId).toBeNull()
  })

  it('adds nothing in All and Personal', () => {
    expect(planIn(scope, 'all', 3).labelId).toBeNull()
    expect(planIn(scope, 'personal', 3).labelId).toBeNull()
  })

  it('says so when no work label is set', () => {
    expect(planIn(noLabel, 'work', 3)).toEqual({ labelId: null, staysPersonal: true })
  })

  it('gives a duplicate nothing', () => {
    expect(planIn(scope, 'work', 3, [], true)).toEqual({ labelId: null, staysPersonal: false })
    expect(planIn(noLabel, 'work', 3, [], true).staysPersonal).toBe(false)
  })
})

describe('namedLabelIds', () => {
  const known = [{ id: 7, title: 'Work' }, { id: 8, title: 'Home' }]

  it('takes ids and matches titles to known labels', () => {
    expect(namedLabelIds([{ id: 8 }, { title: 'work' }, { title: 'new one' }], known)).toEqual([{ id: 8 }, { id: 7 }])
  })

  it('is empty without refs', () => {
    expect(namedLabelIds(undefined, known)).toEqual([])
  })
})
