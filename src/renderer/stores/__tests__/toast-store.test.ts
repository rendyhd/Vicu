import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOAST_DEDUPE_MS, TOAST_LIFETIME_MS, toast, useToastStore } from '../toast-store'

describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    for (const t of useToastStore.getState().toasts) useToastStore.getState().dismiss(t.id)
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

  it('shows a success toast with an action and closes it after the action', () => {
    const onAction = vi.fn()
    const id = toast.success('Completed', { action: { label: 'Undo', onAction } })
    const shown = useToastStore.getState().toasts[0]
    expect(shown).toMatchObject({ id, kind: 'success', message: 'Completed', action: { label: 'Undo' } })
    shown.action?.onAction()
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('uses its own duration and never expires with a null duration', () => {
    toast.success('Short', { durationMs: 1000 })
    toast.success('Forever', { durationMs: null })
    vi.advanceTimersByTime(1001)
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['Forever'])
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('updates the toast with the same key in place and restarts its clock', () => {
    const first = toast.success('Completed', { key: 'c', durationMs: 1000 })
    vi.advanceTimersByTime(800)
    const second = toast.success('2 completed', { key: 'c', durationMs: 1000 })
    expect(second).toBe(first)
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['2 completed'])
    vi.advanceTimersByTime(800)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(201)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('pauses while the pointer or focus is on it and starts a full duration afterwards', () => {
    const id = toast.success('Marked reviewed', { durationMs: 1000 })
    vi.advanceTimersByTime(900)
    useToastStore.getState().engage(id, true)
    vi.advanceTimersByTime(60_000)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    useToastStore.getState().engage(id, false)
    vi.advanceTimersByTime(999)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(2)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('hands engagement to the owner when it asks for it, and leaves the clock alone', () => {
    const onEngage = vi.fn()
    const id = toast.success('Completed', { durationMs: 1000, onEngage })
    useToastStore.getState().engage(id, true)
    expect(onEngage).toHaveBeenCalledWith(true)
    vi.advanceTimersByTime(1001)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('tells the owner when the user closes or lets it expire, not when the owner removes it', () => {
    const onClose = vi.fn()
    const id = toast.success('A', { key: 'a', onClose })
    useToastStore.getState().dismiss(id)
    expect(onClose).toHaveBeenCalledTimes(1)
    toast.success('B', { key: 'b', onClose })
    useToastStore.getState().remove('b')
    expect(onClose).toHaveBeenCalledTimes(1)
    toast.success('C', { durationMs: 500, onClose })
    vi.advanceTimersByTime(501)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  describe('eviction', () => {
    it('keeps a toast its owner closes itself while other toasts go', () => {
      toast.success('Completed', { key: 'completion', durationMs: null })
      for (let i = 0; i < 6; i++) toast.error(`Failure ${i}`)
      const messages = useToastStore.getState().toasts.map((t) => t.message)
      expect(messages).toHaveLength(4)
      expect(messages[0]).toBe('Completed')
      expect(messages[3]).toBe('Failure 5')
    })

    it('tells the owner of an evicted toast that the pointer has left it', () => {
      const engaged: boolean[][] = [[], [], [], [], []]
      for (let i = 0; i < 5; i++) {
        toast.success(`Owned ${i}`, { key: `k${i}`, durationMs: null, onEngage: (on) => engaged[i].push(on) })
      }
      const shown = useToastStore.getState().toasts.map((t) => t.message)
      expect(shown).toEqual(['Owned 1', 'Owned 2', 'Owned 3', 'Owned 4'])
      expect(engaged[0]).toEqual([false])
      expect(engaged[1]).toEqual([])
    })
  })
})
