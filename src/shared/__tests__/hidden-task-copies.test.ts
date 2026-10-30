import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasVicuMetadataMarker as rendererRule } from '../../renderer/lib/metadata-tasks'
import { hasVicuMetadataMarker as mainRule, hasCustomListMarker, parseCustomListEnvelope } from '../../main/custom-list-protocol'
import { hasRoutineArchiveMarker, hasRoutineMarker, parseRoutineEnvelope } from '../routines'

/**
 * The renderer (lists, search, Quick Find) and the main process (Quick View) hide tasks with the
 * one rule of shared/hidden-tasks.ts: both answer every `hiddenTasks.markers` vector.
 */
const { hiddenTasks } = JSON.parse(
  readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8'),
) as { hiddenTasks: { markers: Array<{ name: string; description: string | null; hidden: boolean }> } }

describe('both copies of the hiding rule follow the contract', () => {
  for (const vector of hiddenTasks.markers) {
    it(vector.name, () => {
      expect(rendererRule(vector.description)).toBe(vector.hidden)
      expect(mainRule(vector.description)).toBe(vector.hidden)
    })
  }

  it('keeps inline duration metadata visible in both processes', () => {
    const description = '<p>Ordinary task</p>\n<!-- vicu-duration:v1:120 -->'
    expect(rendererRule(description)).toBe(false)
    expect(mainRule(description)).toBe(false)
  })

  it('recognises each kind by its marker only, with the same whitespace rule', () => {
    expect(hasCustomListMarker('<!--\n\tvicu-custom-lists:v1:e30 -->')).toBe(true)
    expect(hasCustomListMarker('<!-- vicu-custom-lists:v1:e30 -->')).toBe(false)
    expect(hasCustomListMarker('')).toBe(false)
    expect(hasRoutineMarker('<!--vicu-routine:v1:e30-->')).toBe(true)
    expect(hasRoutineMarker('<!-- vicu-routine:archive:v1:e30 -->')).toBe(false)
    expect(hasRoutineArchiveMarker('<!-- vicu-routine:archive:v1:e30 -->')).toBe(true)
  })

  it('treats an unclosed marker as an unreadable carrier of its kind', () => {
    expect(parseCustomListEnvelope('<!-- vicu-custom-lists:')).toMatchObject({ isCarrier: true, error: expect.any(String) })
    expect(parseRoutineEnvelope('<!-- vicu-routine:v1:')).toMatchObject({ isCarrier: true, error: expect.any(String) })
  })
})
