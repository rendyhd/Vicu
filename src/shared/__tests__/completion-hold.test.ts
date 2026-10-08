import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COMPLETION_HOLD_MS,
  COMPLETION_TOAST_ACTION,
  COMPLETION_TOAST_MS,
  CompletionHold,
  completionToastText,
} from '../completion-hold'

// Section 7 of docs/cross-app-semantics-v1.md and the `completion` block of the shared fixture.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', '..', 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8'),
).completion as {
  holdMs: number
  toastMs: number
  toast: { single: string; many: string; action: string }
  vectors: Array<{
    name: string
    events: Array<{ at: number; type: string; row?: number; target?: string; via?: string }>
    expect: Array<{ at: number; held: number[]; collapsed: number[]; toast: string | null }>
  }>
}

describe('completion constants', () => {
  it('match the fixture', () => {
    expect(COMPLETION_HOLD_MS).toBe(fixture.holdMs)
    expect(COMPLETION_TOAST_MS).toBe(fixture.toastMs)
    expect(COMPLETION_TOAST_ACTION).toBe(fixture.toast.action)
    expect(completionToastText(1)).toBe(fixture.toast.single)
    expect(completionToastText(2)).toBe(fixture.toast.many.replace('{n}', '2'))
    expect(completionToastText(12)).toBe(fixture.toast.many.replace('{n}', '12'))
  })
})

describe('completion vectors', () => {
  it('has the 20 vectors', () => {
    expect(fixture.vectors).toHaveLength(20)
  })

  for (const vector of fixture.vectors) {
    it(vector.name, () => {
      const hold = new CompletionHold()
      let next = 0
      for (const step of vector.expect) {
        // Events up to and including this time, in order; each fires the timers due before it.
        while (next < vector.events.length && vector.events[next].at <= step.at) {
          const ev = vector.events[next++]
          switch (ev.type) {
            case 'complete':
              hold.complete(ev.row!, ev.at)
              break
            case 'hoverStart':
            case 'hoverEnd':
              if (ev.target === 'toast') hold.hoverToast(ev.type === 'hoverStart', ev.at)
              else hold.hover(ev.row!, ev.type === 'hoverStart', ev.at)
              break
            case 'focusIn':
            case 'focusOut':
              if (ev.target === 'toast') hold.focusToast(ev.type === 'focusIn', ev.at)
              else hold.focusRow(ev.row!, ev.type === 'focusIn', ev.at)
              break
            case 'navigate':
              hold.navigate(ev.at)
              break
            case 'undo':
              if (ev.via === 'toast') hold.undoToast(ev.at)
              else hold.undoRow(ev.row!, ev.at)
              break
            default:
              throw new Error(`unknown event ${ev.type}`)
          }
        }
        expect(hold.snapshot(step.at), `${vector.name} at ${step.at}`).toEqual({
          held: step.held,
          collapsed: step.collapsed,
          toast: step.toast,
        })
      }
    })
  }
})

describe('CompletionHold beyond the vectors', () => {
  it('reports the next timer and none while everything is engaged or idle', () => {
    const hold = new CompletionHold()
    expect(hold.nextDeadline()).toBeNull()
    hold.hover(1, true, 0)
    hold.complete(1, 100)
    expect(hold.nextDeadline()).toBeNull()
    hold.complete(2, 200)
    expect(hold.nextDeadline()).toBe(5200)
    hold.hover(1, false, 1000)
    expect(hold.nextDeadline()).toBe(5200)
    hold.snapshot(5200)
    // Row 2 collapsed at 5200 and made the toast; row 1 (released at 1000) went at 6000.
    expect(hold.nextDeadline()).toBe(6000)
    hold.snapshot(6000)
    expect(hold.nextDeadline()).toBe(12000)
  })

  it('hands out each collapsed id once', () => {
    const hold = new CompletionHold()
    hold.complete(3, 0)
    hold.complete(1, 10)
    expect(hold.takeCollapsed()).toEqual([])
    hold.snapshot(5010)
    expect(hold.takeCollapsed()).toEqual([3, 1])
    expect(hold.takeCollapsed()).toEqual([])
    hold.complete(7, 6000)
    hold.navigate(6001)
    expect(hold.takeCollapsed()).toEqual([7])
  })

  it('a row removed while hovered does not keep a stale pointer when it comes back', () => {
    const hold = new CompletionHold()
    hold.hover(1, true, 0)
    hold.complete(1, 0)
    hold.navigate(100)
    // The removed element never sent "left". The toast Undo reopens the row; completing it again
    // must not find the old pointer.
    expect(hold.undoToast(200)).toEqual([1])
    hold.complete(1, 300)
    expect(hold.snapshot(5299).held).toEqual([1])
    expect(hold.snapshot(5300).held).toEqual([])
  })

  it('undoToast returns what the toast covers and a row held meanwhile stays held', () => {
    const hold = new CompletionHold()
    hold.complete(1, 0)
    hold.complete(2, 4000)
    expect(hold.snapshot(5000).toast).toBe('Completed')
    expect(hold.undoToast(5500)).toEqual([1])
    expect(hold.toastIds()).toEqual([])
    expect(hold.snapshot(5500)).toEqual({ held: [2], collapsed: [], toast: null })
  })

  it('forget drops a row everywhere and removes a toast that becomes empty', () => {
    const hold = new CompletionHold()
    hold.complete(1, 0)
    hold.complete(2, 0)
    hold.snapshot(5000)
    expect(hold.snapshot(5000).toast).toBe('2 completed')
    hold.forget(1, 5100)
    expect(hold.snapshot(5100)).toEqual({ held: [], collapsed: [2], toast: 'Completed' })
    hold.forget(2, 5200)
    expect(hold.snapshot(5200)).toEqual({ held: [], collapsed: [], toast: null })
    // A forgotten held row has no timer left.
    hold.complete(3, 6000)
    hold.forget(3, 6001)
    expect(hold.nextDeadline()).toBeNull()
  })

  it('fires a row before the toast when both are due at the same instant', () => {
    const hold = new CompletionHold()
    hold.complete(1, 0)
    hold.complete(2, 6000) // toast of row 1 is due at 11000, row 2 collapses at 11000
    hold.snapshot(5000)
    expect(hold.snapshot(11000)).toEqual({ held: [], collapsed: [1, 2], toast: '2 completed' })
  })

  it('ignores time going backwards', () => {
    const hold = new CompletionHold()
    hold.complete(1, 1000)
    expect(hold.snapshot(500).held).toEqual([1])
    expect(hold.snapshot(6000)).toEqual({ held: [], collapsed: [1], toast: 'Completed' })
  })

  it('honours custom durations', () => {
    const hold = new CompletionHold({ holdMs: 100, toastMs: 200 })
    hold.complete(1, 0)
    expect(hold.snapshot(100).toast).toBe('Completed')
    expect(hold.snapshot(299).toast).toBe('Completed')
    expect(hold.snapshot(300).toast).toBeNull()
  })
})
