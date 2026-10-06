import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOAST_DEDUPE_MS, TOAST_LIFETIME_MS, toast, useToastStore } from '../toast-store'

describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows an identical message once during a burst', () => {
    toast.error('Could not complete the task: offline')
    toast.error('Could not complete the task: offline')
    toast.error('Could not complete the task: offline')
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('shows the same message again once the burst window has passed and the first is gone', () => {
    toast.error('Same')
    vi.advanceTimersByTime(TOAST_DEDUPE_MS + 1)
    toast.error('Same')
    expect(useToastStore.getState().toasts).toHaveLength(2)
  })

  it('keeps different messages and kinds apart', () => {
    toast.error('One')
    toast.info('Two')
    expect(useToastStore.getState().toasts.map((t) => t.kind)).toEqual(['error', 'info'])
  })

  it('dismisses a toast after its lifetime', () => {
    toast.info('Saved')
    vi.advanceTimersByTime(TOAST_LIFETIME_MS + 1)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('keeps only the most recent few', () => {
    for (let i = 0; i < 8; i++) toast.error(`Failure ${i}`)
    const messages = useToastStore.getState().toasts.map((t) => t.message)
    expect(messages).toHaveLength(4)
    expect(messages[3]).toBe('Failure 7')
  })
})
