import { create } from 'zustand'

/**
 * A message for screen readers only, read from the always-mounted live region of the ToastHost
 * ("Completed Buy milk"). The nonce makes the same text announced again.
 */
interface AnnouncerState {
  message: string
  nonce: number
}

export const useAnnouncerStore = create<AnnouncerState>(() => ({ message: '', nonce: 0 }))

export function announce(message: string): void {
  useAnnouncerStore.setState((state) => ({ message, nonce: state.nonce + 1 }))
}
