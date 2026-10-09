import { create } from 'zustand'
import { COMPLETION_TOAST_ACTION, CompletionHold } from '../../shared/completion-hold'
import { useToastStore } from '@/stores/toast-store'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import type { CompletedTaskEntry } from '@/stores/completed-tasks-store'

/**
 * The completion hold at run time (docs/cross-app-semantics-v1.md section 7): the pure state machine
 * of `src/shared/completion-hold.ts`, one real timer for its next deadline, and the two things the
 * app has to do when it moves.
 *
 * - A held row is a `completed-tasks-store` entry (the list merges keep showing it, struck through).
 *   When the hold ends the row is marked `collapsing` (it fades and its height closes, see
 *   `useCompletionCollapse`) and the entry is removed when that is done, which is what makes the row
 *   leave the list. Leaving the view removes the entries at once.
 * - Rows that collapsed make up the toast. Their entries are kept here so the toast's Undo can put
 *   them back and send `{ done: false }` for each (`useUndoCompletedTasks`).
 */

export interface CompletionToastState {
  /** The text: "Completed" or "{n} completed". */
  text: string
  /** Task ids the toast covers. */
  ids: number[]
}

interface CompletionHoldState {
  /** Task ids still shown in their list as done. */
  held: ReadonlySet<number>
  /** Task ids whose hold ended and whose row is closing; the entry goes when the row says it is done. */
  collapsing: ReadonlySet<number>
  toast: CompletionToastState | null
}

/**
 * If no row reports that it finished closing (it is not on screen), the entry goes after this. A plain
 * limit, not a motion: it only has to stay above the row close (--dur-move, 320 ms) so a visible row
 * always finishes first; a row that is not on screen has no animation to wait for.
 */
export const COLLAPSE_LIMIT_MS = 600

const EMPTY: ReadonlySet<number> = new Set()

export const useCompletionHoldStore = create<CompletionHoldState>(() => ({ held: EMPTY, collapsing: EMPTY, toast: null }))

let machine = new CompletionHold()
let timer: ReturnType<typeof setTimeout> | null = null
/** Entries of the rows the toast covers, so Undo can bring them back. */
const collapsedEntries = new Map<number, CompletedTaskEntry>()
const collapseTimers = new Map<number, ReturnType<typeof setTimeout>>()

function sameIds(a: ReadonlySet<number>, b: readonly number[]): boolean {
  return a.size === b.length && b.every((id) => a.has(id))
}

function setCollapsing(next: (ids: Set<number>) => void): void {
  const ids = new Set(useCompletionHoldStore.getState().collapsing)
  next(ids)
  useCompletionHoldStore.setState({ collapsing: ids.size === 0 ? EMPTY : ids })
}

/** The row has closed (or was never on screen): its entry leaves the completed-tasks store. */
function finishCollapse(id: number): void {
  const timerId = collapseTimers.get(id)
  if (timerId !== undefined) clearTimeout(timerId)
  collapseTimers.delete(id)
  if (!useCompletionHoldStore.getState().collapsing.has(id)) return
  setCollapsing((ids) => ids.delete(id))
  useCompletedTasksStore.getState().remove(id)
}

function cancelCollapse(id: number): void {
  const timerId = collapseTimers.get(id)
  if (timerId !== undefined) clearTimeout(timerId)
  collapseTimers.delete(id)
  if (useCompletionHoldStore.getState().collapsing.has(id)) setCollapsing((ids) => ids.delete(id))
}

/** Move the machine to now, apply what it did to the stores, publish the state and re-arm the timer. */
function sync(animate = true): void {
  const now = Date.now()
  machine.advance(now)

  for (const id of machine.takeCollapsed()) {
    const completed = useCompletedTasksStore.getState()
    const entry = completed.tasks.get(id)
    if (entry) collapsedEntries.set(id, entry)
    if (animate && entry) {
      setCollapsing((ids) => ids.add(id))
      collapseTimers.set(id, setTimeout(() => finishCollapse(id), COLLAPSE_LIMIT_MS))
    } else {
      completed.remove(id)
    }
  }

  const snapshot = machine.snapshot(now)
  const toastIds = machine.toastIds()
  for (const id of [...collapsedEntries.keys()]) if (!toastIds.includes(id)) collapsedEntries.delete(id)

  const current = useCompletionHoldStore.getState()
  const held = sameIds(current.held, snapshot.held) ? current.held : new Set(snapshot.held)
  const toast =
    snapshot.toast === null
      ? null
      : current.toast && current.toast.text === snapshot.toast && sameArray(current.toast.ids, toastIds)
        ? current.toast
        : { text: snapshot.toast, ids: toastIds }
  if (held !== current.held || toast !== current.toast) useCompletionHoldStore.setState({ held, toast })
  if (toast !== current.toast) showToast(toast)

  if (timer !== null) clearTimeout(timer)
  timer = null
  const deadline = machine.nextDeadline()
  if (deadline !== null) {
    // A timer can fire a hair early; sync() then re-arms for the rest.
    timer = setTimeout(() => {
      timer = null
      sync()
    }, Math.max(0, deadline - Date.now()))
  }
}

const TOAST_KEY = 'completion'
let undoHandler: (() => void) | null = null

/**
 * Who reopens the tasks when the toast's Undo is pressed: a mounted component that has the reopen
 * mutation (`useUndoCompletedTasks`). Returns the function that removes it again.
 */
export function setCompletionUndoHandler(handler: () => void): () => void {
  undoHandler = handler
  return () => {
    if (undoHandler === handler) undoHandler = null
  }
}

/** The machine owns this toast's clock (6 s, paused while engaged), so the toast store never expires it. */
function showToast(toast: CompletionToastState | null): void {
  const toasts = useToastStore.getState()
  if (toast === null) {
    toasts.remove(TOAST_KEY)
    return
  }
  toasts.push('success', toast.text, {
    key: TOAST_KEY,
    durationMs: null,
    action: { label: COMPLETION_TOAST_ACTION, onAction: () => undoHandler?.() },
    onEngage: (engaged) => completionHold.hoverToast(engaged),
    onClose: () => completionHold.dismissToast(),
  })
}

function sameArray(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** Non-component entry points; every call moves the machine to the present first. */
export const completionHold = {
  /** A task was completed in a list: hold its row. */
  complete(taskId: number): void {
    const now = Date.now()
    // It was open on screen, so any older "collapsed" memory of it is stale (reopened elsewhere).
    if (machine.isCollapsed(taskId)) machine.forget(taskId, now)
    machine.complete(taskId, now)
    sync()
  },
  /** A task is open again (unchecked, reopened from the Logbook, or its completion failed). No toast. */
  reopened(taskId: number): void {
    cancelCollapse(taskId)
    machine.forget(taskId, Date.now())
    collapsedEntries.delete(taskId)
    sync()
  },
  hoverRow(taskId: number, on: boolean): void {
    machine.hover(taskId, on, Date.now())
    sync()
  },
  focusRow(taskId: number, on: boolean): void {
    machine.focusRow(taskId, on, Date.now())
    sync()
  },
  hoverToast(on: boolean): void {
    machine.hoverToast(on, Date.now())
    sync()
  },
  focusToast(on: boolean): void {
    machine.focusToast(on, Date.now())
    sync()
  },
  /** The user left the view: every held row collapses now. */
  navigate(): void {
    for (const id of useCompletionHoldStore.getState().collapsing) finishCollapse(id)
    machine.navigate(Date.now())
    sync(false)
  },
  /** The row of a collapsed task finished closing: take its entry out of the completed-tasks store. */
  finishCollapse,
  /** The user closed the toast: it goes, the rows stay collapsed. */
  dismissToast(): void {
    machine.dismissToast(Date.now())
    sync()
  },
  /**
   * Take the toast's Undo: the toast goes and the entries of the rows it covered are returned, to be
   * put back in the completed-tasks store and reopened with `{ done: false }` each.
   */
  takeUndo(): CompletedTaskEntry[] {
    const ids = machine.undoToast(Date.now())
    const entries = ids.flatMap((id) => {
      const entry = collapsedEntries.get(id)
      return entry ? [entry] : []
    })
    for (const id of ids) {
      collapsedEntries.delete(id)
      cancelCollapse(id)
    }
    sync()
    return entries
  },
}

/** Tests: a fresh machine, no timer, empty stores. */
export function resetCompletionHold(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  machine = new CompletionHold()
  collapsedEntries.clear()
  for (const timerId of collapseTimers.values()) clearTimeout(timerId)
  collapseTimers.clear()
  undoHandler = null
  useCompletionHoldStore.setState({ held: EMPTY, collapsing: EMPTY, toast: null })
  useToastStore.getState().remove(TOAST_KEY)
}
