import { describe, expect, it } from 'vitest'
import {
  formatTaskDuration,
  parseTaskDuration,
  stripTaskDuration,
  withTaskDuration,
} from '../task-duration'

describe('task duration metadata', () => {
  it('round-trips whole minutes in a hidden v1 comment', () => {
    const description = withTaskDuration('<p>Write the report</p>', 45)

    expect(description).toBe('<p>Write the report</p>\n<!-- vicu-duration:v1:45 -->')
    expect(parseTaskDuration(description)).toBe(45)
    expect(formatTaskDuration(45)).toBe('45m')
  })

  it('works without notes and clears back to an empty description', () => {
    const description = withTaskDuration(undefined, 90)

    expect(description).toBe('<!-- vicu-duration:v1:90 -->')
    expect(stripTaskDuration(description)).toBe('')
    expect(withTaskDuration(description, null)).toBe('')
  })

  it('replaces the existing value without duplicating the marker', () => {
    const description = withTaskDuration(withTaskDuration('<p>Notes</p>', 30), 75)

    expect(description).toBe('<p>Notes</p>\n<!-- vicu-duration:v1:75 -->')
    expect(parseTaskDuration(description)).toBe(75)
  })

  it('preserves other metadata and an unknown duration version', () => {
    const description = '<p>Notes</p>\n<!-- notelink:obsidian://open -->\n<!-- vicu-duration:v2:60 -->'

    expect(stripTaskDuration(description)).toBe(description)
    expect(withTaskDuration(description, null)).toBe(description)
    expect(parseTaskDuration(description)).toBeNull()
  })

  it.each([null, undefined, '', '<p>Plain notes</p>', '<!-- vicu-duration:v1:0 -->', '<!-- vicu-duration:v1:1.5 -->', '<!-- vicu-duration:v1:9007199254740992 -->'])(
    'has no duration for %s',
    (description) => {
      expect(parseTaskDuration(description)).toBeNull()
    },
  )

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid duration of %s', (minutes) => {
    expect(() => withTaskDuration('', minutes)).toThrow('positive whole number')
  })
})
