import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FIRST_UPDATE_CHECK_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
  startUpdateChecks,
  type UpdateChecksHandle,
} from '../update-schedule'
import type { UpdateStatus } from '../update-version'

const status = (latestVersion: string, available = true): UpdateStatus => ({
  available,
  currentVersion: '1.8.1',
  latestVersion,
  releaseUrl: `https://example.com/v${latestVersion}`,
  releaseNotes: '',
})

describe('update checks', () => {
  let handle: UpdateChecksHandle | null = null
  let latest: UpdateStatus
  let dismissed: string | undefined
  const check = vi.fn(async () => latest)
  const notify = vi.fn<(s: UpdateStatus) => boolean | void>()

  beforeEach(() => {
    vi.useFakeTimers()
    latest = status('1.9.0')
    dismissed = undefined
    check.mockClear()
    notify.mockReset()
    handle = startUpdateChecks({ check, dismissedVersion: () => dismissed, notify })
  })

  afterEach(() => {
    handle?.stop()
    vi.useRealTimers()
  })

  it('checks shortly after start and then every 12 hours', async () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(12 * 60 * 60 * 1000)
    expect(check).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(FIRST_UPDATE_CHECK_DELAY_MS)
    expect(check).toHaveBeenCalledTimes(1)

    // The 12 hour timer runs from the start of the app.
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS - FIRST_UPDATE_CHECK_DELAY_MS - 1)
    expect(check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(check).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(check).toHaveBeenCalledTimes(3)
  })

  it('tells the window about an update once, not at every check', async () => {
    await vi.advanceTimersByTimeAsync(FIRST_UPDATE_CHECK_DELAY_MS)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(latest)

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(check.mock.calls.length).toBeGreaterThan(2)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('tells about a newer release found later in a long-running session', async () => {
    await vi.advanceTimersByTimeAsync(FIRST_UPDATE_CHECK_DELAY_MS)
    latest = status('1.9.1')
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ latestVersion: '1.9.1' }))
  })

  it('stays quiet when there is no update', async () => {
    latest = status('1.8.1', false)
    await vi.advanceTimersByTimeAsync(FIRST_UPDATE_CHECK_DELAY_MS + UPDATE_CHECK_INTERVAL_MS)
    expect(notify).not.toHaveBeenCalled()
  })

  it('stays quiet about the version the user dismissed, and speaks up for the next one', async () => {
    dismissed = '1.9.0'
    await vi.advanceTimersByTimeAsync(FIRST_UPDATE_CHECK_DELAY_MS)
    expect(notify).not.toHaveBeenCalled()

    latest = status('1.9.1')
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('tries again later when nobody could be told', async () => {
    notify.mockReturnValueOnce(false)
    await vi.advanceTimersByTimeAsync(FIRST_UPDATE_CHECK_DELAY_MS)
    expect(notify).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('survives a failed check and keeps its schedule', async () => {
    check.mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(FIRST_UPDATE_CHECK_DELAY_MS)
    expect(notify).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('stops checking when stopped', async () => {
    handle?.stop()
    await vi.advanceTimersByTimeAsync(FIRST_UPDATE_CHECK_DELAY_MS + 2 * UPDATE_CHECK_INTERVAL_MS)
    expect(check).not.toHaveBeenCalled()
  })
})
