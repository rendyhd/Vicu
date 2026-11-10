import { describe, expect, it } from 'vitest'
import { ruleFromDisplay, ruleToDisplay, suggestRule } from '../rule-editing'

const labels = [{ id: 3, name: 'Work' }, { id: 4, name: 'Errands, small' }]
const projects = [{ id: 7, name: 'Home' }]

describe('rule editing', () => {
  it('shows names for known ids and keeps unknown ids', () => {
    expect(ruleToDisplay('labels in 3, 9 && project = 7', labels, projects)).toBe('labels in Work, 9 && project = Home')
  })

  it('quotes a name that needs it', () => {
    expect(ruleToDisplay('labels = 4', labels, projects)).toBe("labels = 'Errands, small'")
  })

  it('saves names as ids, ignoring case', () => {
    expect(ruleFromDisplay('labels in work, 9 && project = Home', labels, projects)).toEqual({ rule: 'labels in 3, 9 && project = 7' })
  })

  it('round-trips through the display form', () => {
    const rule = 'done = false && labels = 4'
    expect(ruleFromDisplay(ruleToDisplay(rule, labels, projects), labels, projects)).toEqual({ rule })
  })

  it('names a label that does not exist', () => {
    expect(ruleFromDisplay('labels = Nope', labels, projects)).toEqual({ problem: 'There is no label named "Nope".' })
  })

  it('an empty rule is none', () => {
    expect(ruleFromDisplay('  ', labels, projects)).toEqual({ rule: undefined })
  })

  it('reports a rule that does not read', () => {
    expect('problem' in ruleFromDisplay('done = ', labels, projects)).toBe(true)
  })

  it('suggests fields, operators, values and joins', () => {
    expect(suggestRule('pri', 3, labels, projects).map((s) => s.label)).toEqual(['priority'])
    expect(suggestRule('priority ', 9, labels, projects).map((s) => s.label)).not.toContain('like')
    expect(suggestRule('labels = W', 10, labels, projects)).toEqual([{ label: 'Work', insert: 'Work', start: 9, end: 10 }])
    expect(suggestRule('done = true ', 12, labels, projects).map((s) => s.label)).toEqual(['&&', '||'])
  })
})
