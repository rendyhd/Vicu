import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { labelFilterChoices, shownWithLabels } from '../project-label-filter'

interface Vectors {
  labels: Array<{ id: number; title: string }>
  tasks: Array<{ id: number; title: string; labels: number[]; parent?: number }>
  choices: Array<{ name: string; picked: number[]; expect: Array<{ id: number; count: number }> }>
  shown: Array<{ name: string; picked: number[]; expect: number[] }>
}

const vectors = (JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8')) as {
  projectLabelFilter: Vectors
}).projectLabelFilter

const labelOf = (id: number) => {
  const label = vectors.labels.find((candidate) => candidate.id === id)
  if (!label) throw new Error(`label ${id} is not in the vectors`)
  return label
}
const tasks = vectors.tasks.map((task) => ({ id: task.id, parent: task.parent, labels: task.labels.map(labelOf) }))

describe('projectLabelFilter (contract section 17.2)', () => {
  for (const vector of vectors.choices) {
    it(`choices: ${vector.name}`, () => {
      const choices = labelFilterChoices(tasks, vector.picked, vectors.labels)
      expect(choices.map((choice) => ({ id: choice.label.id, count: choice.count }))).toEqual(vector.expect)
    })
  }
  for (const vector of vectors.shown) {
    it(`shown: ${vector.name}`, () => {
      expect(shownWithLabels(tasks, vector.picked, (task) => task.parent).map((task) => task.id)).toEqual(vector.expect)
    })
  }
})
