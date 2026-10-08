import { create } from 'zustand'
import { COMPLETION_TOAST_MS } from '../../shared/completion-hold'

export type ToastKind = 'error' | 'info' | 'success'

/** What a screen reader hears before the message: the kind is never carried by colour alone. */
export const TOAST_KIND_LABEL: Record<ToastKind, string> = {
  error: 'Error',
  info: 'Information',
  success: 'Success',
}

export interface ToastAction {
  label: string
  onAction: () => void
}

export interface ToastOptions {
  /** A button on the toast ("Undo"). Clicking it runs `onAction`, then closes the toast. */
  action?: ToastAction
  /** How long it stays once nothing is on it; `null` never expires (its owner closes it). Default 7 s. */
  durationMs?: number | null
  /** The same key shows one toast: a new call updates it in place (and restarts its clock). */
  key?: string
  /**
   * Called when the pointer or keyboard focus enters (`true`) or leaves (`false`) the toast. When it is
   * given the owner decides what that means (a toast that keeps its own clock); otherwise the toast
   * clock pauses while engaged and a full duration starts when it ends.
   */
  onEngage?: (engaged: boolean) => void
  /** Called when the user closes the toast (the Dismiss button) or it expires, not when its owner removes it. */
  onClose?: () => void
}

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  key?: string
  action?: ToastAction
  onEngage?: (engaged: boolean) => void
}

interface ToastState {
  toasts: Toast[]
  /** Show a toast. The same message again within a few seconds is shown once, not stacked. */
  push: (kind: ToastKind, message: string, options?: ToastOptions) => number
  /** Close a toast as the user would (calls its `onClose`). */
  dismiss: (id: number) => void
  /** Remove the toast with this key without telling its owner. */
  remove: (key: string) => void
  /** The pointer or keyboard focus entered or left a toast. */
  engage: (id: number, engaged: boolean) => void
}

/** How long a toast stays when nothing dismisses it. */
export const TOAST_LIFETIME_MS = 7_000
/** How long a toast with an Undo stays (the completion toast and the review toast), same engagement rule. */
export const UNDO_TOAST_MS = COMPLETION_TOAST_MS
/** An identical toast inside this window is dropped (a burst of failures from one outage). */
export const TOAST_DEDUPE_MS = 3_000
const MAX_TOASTS = 4

let nextId = 1
const lastShown = new Map<string, number>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()
const durations = new Map<number, number | null>()
const closers = new Map<number, () => void>()

function clearClock(id: number) {
  const timer = timers.get(id)
  if (timer !== undefined) clearTimeout(timer)
  timers.delete(id)
}

export const useToastStore = create<ToastState>((set, get) => {
  const startClock = (id: number) => {
    clearClock(id)
    const duration = durations.get(id)
    if (duration === null || duration === undefined) return
    timers.set(id, setTimeout(() => get().dismiss(id), duration))
  }
  const forget = (id: number) => {
    clearClock(id)
    durations.delete(id)
    closers.delete(id)
  }

  return {
    toasts: [],
    push: (kind, message, options = {}) => {
      const { key, action, onEngage, onClose } = options
      const durationMs = options.durationMs === undefined ? TOAST_LIFETIME_MS : options.durationMs

      if (key !== undefined) {
        const existing = get().toasts.find((t) => t.key === key)
        if (existing) {
          durations.set(existing.id, durationMs)
          if (onClose) closers.set(existing.id, onClose)
          else closers.delete(existing.id)
          set((state) => ({
            toasts: state.toasts.map((t) => (t.id === existing.id ? { ...t, kind, message, action, onEngage } : t)),
          }))
          startClock(existing.id)
          return existing.id
        }
      } else {
        const dedupeKey = `${kind}:${message}`
        const now = Date.now()
        const previous = lastShown.get(dedupeKey)
        const duplicate = get().toasts.find((t) => t.message === message)
        if (previous !== undefined && now - previous < TOAST_DEDUPE_MS && duplicate) return duplicate.id
        lastShown.set(dedupeKey, now)
      }

      const id = nextId++
      durations.set(id, durationMs)
      if (onClose) closers.set(id, onClose)
      set((state) => {
        const next = [...state.toasts, { id, kind, message, key, action, onEngage }]
        for (const gone of next.slice(0, Math.max(0, next.length - MAX_TOASTS))) forget(gone.id)
        return { toasts: next.slice(-MAX_TOASTS) }
      })
      startClock(id)
      return id
    },
    dismiss: (id) => {
      if (!get().toasts.some((t) => t.id === id)) return
      const onClose = closers.get(id)
      forget(id)
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
      onClose?.()
    },
    remove: (key) => {
      const found = get().toasts.find((t) => t.key === key)
      if (!found) return
      forget(found.id)
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== found.id) }))
    },
    engage: (id, engaged) => {
      const toast = get().toasts.find((t) => t.id === id)
      if (!toast) return
      if (toast.onEngage) {
        toast.onEngage(engaged)
        return
      }
      // Pause while engaged; a full duration starts when the pointer and focus have both left.
      if (engaged) clearClock(id)
      else startClock(id)
    },
  }
})

/** For non-component code: `toast.error('...')`. */
export const toast = {
  error: (message: string) => useToastStore.getState().push('error', message),
  info: (message: string) => useToastStore.getState().push('info', message),
  success: (message: string, options?: ToastOptions) => useToastStore.getState().push('success', message, options),
}
