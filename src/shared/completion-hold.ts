/**
 * The completion hold of docs/cross-app-semantics-v1.md section 7, as a pure state machine.
 *
 * A completed row is held (still in the list, shown as done) for 5 s after the later of the
 * completion and the last moment it stopped being engaged (pointer over it or focus on it), then
 * collapsed (gone from the list, still done on the server). Collapsed rows join one toast
 * ("Completed", "3 completed") that lives 6 s on the same engagement rule and whose Undo reopens
 * every row it covers. Leaving the view collapses every held row at once.
 *
 * No timers and no clock here: every method takes the time `at` (milliseconds, any origin, never
 * going backwards) and first fires the timers due up to and including that time, so a timer due at
 * the same instant as an event runs before it. The caller schedules one real timer for
 * `nextDeadline()`. Pure and import-free so main, renderer and tests share it.
 */

/** How long a completed row stays in its list after the engagement ends. */
export const COMPLETION_HOLD_MS = 5000
/** How long the "Completed, Undo" toast stays after its last change or the end of engagement. */
export const COMPLETION_TOAST_MS = 6000
export const COMPLETION_TOAST_ACTION = 'Undo'

/** "Completed" for one task, "{n} completed" for two or more. */
export function completionToastText(count: number): string {
  return count <= 1 ? 'Completed' : `${count} completed`
}

export interface CompletionHoldSnapshot {
  /** Row ids still shown in their list as done, ascending. */
  held: number[]
  /** Row ids gone from their list (still done on the server), ascending. */
  collapsed: number[]
  /** The toast text, or null when no toast is showing. */
  toast: string | null
}

export interface CompletionHoldOptions {
  holdMs?: number
  toastMs?: number
}

interface ToastState {
  ids: number[]
  /** The toast clock runs from here: its creation, the last row that joined, or the end of engagement. */
  since: number
  pointer: boolean
  focus: boolean
}

const ascending = (a: number, b: number) => a - b

export class CompletionHold {
  private readonly holdMs: number
  private readonly toastMs: number
  /** Engagement is tracked from before a completion, so a row completed under the pointer is engaged. */
  private readonly pointer = new Set<number>()
  private readonly focus = new Set<number>()
  /** Held row id -> the moment its 5 s started (the completion or the end of the last engagement). */
  private readonly held = new Map<number, number>()
  private readonly collapsed = new Set<number>()
  private toast: ToastState | null = null
  private now = Number.NEGATIVE_INFINITY
  private outbox: number[] = []

  constructor(options: CompletionHoldOptions = {}) {
    this.holdMs = options.holdMs ?? COMPLETION_HOLD_MS
    this.toastMs = options.toastMs ?? COMPLETION_TOAST_MS
  }

  /** The state at `at`, after the timers due by then have fired. */
  snapshot(at: number): CompletionHoldSnapshot {
    this.advance(at)
    return {
      held: [...this.held.keys()].sort(ascending),
      collapsed: [...this.collapsed].sort(ascending),
      toast: this.toast ? completionToastText(this.toast.ids.length) : null,
    }
  }

  /** The ids the toast currently covers (what its Undo reopens). */
  toastIds(): number[] {
    return this.toast ? [...this.toast.ids] : []
  }

  isHeld(id: number): boolean {
    return this.held.has(id)
  }

  isCollapsed(id: number): boolean {
    return this.collapsed.has(id)
  }

  /** The time the next timer fires, or null when nothing waits on a timer (everything engaged or idle). */
  nextDeadline(): number | null {
    let next: number | null = null
    for (const [id, since] of this.held) {
      if (this.isRowEngaged(id)) continue
      const due = since + this.holdMs
      if (next === null || due < next) next = due
    }
    if (this.toast && !this.toast.pointer && !this.toast.focus) {
      const due = this.toast.since + this.toastMs
      if (next === null || due < next) next = due
    }
    return next
  }

  /** Row ids that collapsed since the last call (timers, navigation), each once, in order. */
  takeCollapsed(): number[] {
    const out = this.outbox
    this.outbox = []
    return out
  }

  /** An open row was completed. A row that is already held or collapsed keeps its first deadline. */
  complete(id: number, at: number): void {
    this.advance(at)
    if (this.held.has(id) || this.collapsed.has(id)) return
    this.held.set(id, at)
  }

  /** Unchecking a held row: it is open again, its hold is cancelled, no toast. False when it was not held. */
  undoRow(id: number, at: number): boolean {
    this.advance(at)
    return this.held.delete(id)
  }

  /** The pointer entered or left a row. */
  hover(id: number, on: boolean, at: number): void {
    this.engage(this.pointer, id, on, at)
  }

  /** Keyboard (or assistive) focus entered or left a row. */
  focusRow(id: number, on: boolean, at: number): void {
    this.engage(this.focus, id, on, at)
  }

  /** The pointer entered or left the toast. */
  hoverToast(on: boolean, at: number): void {
    this.advance(at)
    if (!this.toast) return
    this.toast.pointer = on
    this.releaseToast(at)
  }

  /** Focus entered or left the toast. */
  focusToast(on: boolean, at: number): void {
    this.advance(at)
    if (!this.toast) return
    this.toast.focus = on
    this.releaseToast(at)
  }

  /** The user left the view: every held row collapses now, engaged or not. */
  navigate(at: number): void {
    this.advance(at)
    for (const id of [...this.held.keys()].sort(ascending)) this.collapse(id, at)
  }

  /**
   * Undo on the toast: every row it covers is open again and the toast goes. Rows that are still held
   * are not touched. Returns the ids to reopen (empty when no toast is showing).
   */
  undoToast(at: number): number[] {
    this.advance(at)
    if (!this.toast) return []
    const ids = [...this.toast.ids]
    for (const id of ids) this.collapsed.delete(id)
    this.toast = null
    return ids
  }

  /** The user closed the toast (its Dismiss button): it goes, the rows stay collapsed and can no longer be undone from it. */
  dismissToast(at: number): void {
    this.advance(at)
    this.toast = null
  }

  /**
   * A row is open or gone for a reason outside the contract (a failed request rolled it back, it was
   * reopened from the Logbook): drop it from the hold, the collapsed set and the toast. The toast
   * disappears when nothing is left in it. Pointer and focus are kept: the row may still be under
   * them (a collapsed row has already lost both).
   */
  forget(id: number, at: number): void {
    this.advance(at)
    this.held.delete(id)
    this.collapsed.delete(id)
    if (this.toast) {
      this.toast.ids = this.toast.ids.filter((x) => x !== id)
      if (this.toast.ids.length === 0) this.toast = null
    }
  }

  /** Fire every timer due up to and including `at`, in time order; rows before the toast at one instant. */
  advance(at: number): void {
    if (at < this.now) at = this.now
    this.now = at
    for (;;) {
      let rowId: number | null = null
      let rowDue = Number.POSITIVE_INFINITY
      for (const [id, since] of this.held) {
        if (this.isRowEngaged(id)) continue
        const due = since + this.holdMs
        if (due < rowDue || (due === rowDue && rowId !== null && id < rowId)) {
          rowDue = due
          rowId = id
        }
      }
      const toastDue =
        this.toast && !this.toast.pointer && !this.toast.focus
          ? this.toast.since + this.toastMs
          : Number.POSITIVE_INFINITY
      if (rowId !== null && rowDue <= at && rowDue <= toastDue) {
        this.collapse(rowId, rowDue)
      } else if (toastDue <= at) {
        this.toast = null
      } else {
        return
      }
    }
  }

  private isRowEngaged(id: number): boolean {
    return this.pointer.has(id) || this.focus.has(id)
  }

  private engage(set: Set<number>, id: number, on: boolean, at: number): void {
    this.advance(at)
    // A collapsed row is no longer on screen; a late "left" from its removed element means nothing.
    if (this.collapsed.has(id)) return
    const was = this.isRowEngaged(id)
    if (on) set.add(id)
    else set.delete(id)
    if (was && !this.isRowEngaged(id) && this.held.has(id)) this.held.set(id, at)
  }

  private releaseToast(at: number): void {
    if (this.toast && !this.toast.pointer && !this.toast.focus) this.toast.since = at
  }

  private collapse(id: number, at: number): void {
    this.held.delete(id)
    this.collapsed.add(id)
    // The element is going away; it will never report the pointer or focus leaving.
    this.pointer.delete(id)
    this.focus.delete(id)
    this.outbox.push(id)
    if (this.toast) {
      this.toast.ids.push(id)
      this.toast.since = at
    } else {
      this.toast = { ids: [id], since: at, pointer: false, focus: false }
    }
  }
}
