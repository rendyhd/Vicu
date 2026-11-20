import { describe, expect, it } from 'vitest'
import { sessionEndTime } from '../session-state'

// A task's `created` is the server's clock and the session's times are this device's. With the
// server a few seconds ahead, an action made right before End session would fall after the end.
describe('when a session ends', () => {
  const started = '2026-11-12T09:00:00.000Z'
  const now = new Date('2026-11-12T09:30:00.000Z')

  it('is now when nothing made in it is later', () => {
    expect(sessionEndTime(now, started, ['2026-11-12T09:10:00Z', null, undefined, 'not a time'])).toBe('2026-11-12T09:30:00.000Z')
  })

  it('reaches an action the server stamped a little after now', () => {
    expect(sessionEndTime(now, started, ['2026-11-12T09:10:00Z', '2026-11-12T09:30:02.400Z'])).toBe('2026-11-12T09:30:02.400Z')
  })

  it('does not follow a time far ahead, or one from before the session', () => {
    expect(sessionEndTime(now, started, ['2026-11-12T10:30:00Z', '2026-11-12T08:59:00Z'])).toBe('2026-11-12T09:30:00.000Z')
  })
})
