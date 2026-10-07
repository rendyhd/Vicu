import { create } from 'zustand'

export type ToastKind = 'error' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastState {
  toasts: Toast[]
  /** Show a toast. The same message again within a few seconds is shown once, not stacked. */
  push: (kind: ToastKind, message: string) => void
  dismiss: (id: number) => void
}

/** How long a toast stays when nothing dismisses it. */
export const TOAST_LIFETIME_MS = 7_000
/** An identical toast inside this window is dropped (a burst of failures from one outage). */
export const TOAST_DEDUPE_MS = 3_000
const MAX_TOASTS = 4

let nextId = 1
const lastShown = new Map<string, number>()

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message) => {
    const key = `${kind}:${message}`
    const now = Date.now()
    const previous = lastShown.get(key)
    if (previous !== undefined && now - previous < TOAST_DEDUPE_MS && get().toasts.some((t) => t.message === message)) return
    lastShown.set(key, now)

    const id = nextId++
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }].slice(-MAX_TOASTS) }))
    setTimeout(() => get().dismiss(id), TOAST_LIFETIME_MS)
  },
  dismiss: (id) => set((state) => (state.toasts.some((t) => t.id === id) ? { toasts: state.toasts.filter((t) => t.id !== id) } : state)),
}))

/** For non-component code: `toast.error('...')`. */
export const toast = {
  error: (message: string) => useToastStore.getState().push('error', message),
  info: (message: string) => useToastStore.getState().push('info', message),
}
