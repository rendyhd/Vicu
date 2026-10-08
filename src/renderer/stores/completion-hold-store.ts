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
 *   When the hold ends the entry is removed, which is what makes the row leave the list.
 * - Rows that collapsed make up the toast. Their entries are kept here so the toast's Undo can put
 *   them back and send `{ done: false }` for each (`useUndoCompletionToast`).
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
  toast: CompletionToastState | null
}

const EMPTY: ReadonlySet<number> = new Set()

export const useCompletionHoldStore = create<CompletionHoldState>(() => ({ held: EMPTY, toast: null }))

let machine = new CompletionHold()
let timer: ReturnType<typeof setTimeout> | null = null
/** Entries of the rows the toast covers, so Undo can bring them back. */
const collapsedEntries = new Map<number, CompletedTaskEntry>()

function sameIds(a: ReadonlySet<number>, b: readonly number[]): boolean {
  return a.size === b.length && b.every((id) => a.has(id))
}

/** Move the machine to now, apply what it did to the stores, publish the state and re-arm the timer. */
function sync(): void {
  const now = Date.now()
  machine.advance(now)

  for (const id of machine.takeCollapsed()) {
    const completed = useCompletedTasksStore.getState()
    const entry = completed.tasks.get(id)
    if (entry) collapsedEntries.set(id, entry)
    completed.remove(id)
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
    machine.navigate(Date.now())
    sync()
  },
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
    for (const id of ids) collapsedEntries.delete(id)
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
  undoHandler = null
  useCompletionHoldStore.setState({ held: EMPTY, toast: null })
  useToastStore.getState().remove(TOAST_KEY)
}
