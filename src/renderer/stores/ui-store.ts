import { create } from 'zustand'

interface UIState {
  theme: 'light' | 'dark' | 'system'
  commandPaletteOpen: boolean
  /** Bumped to ask the app shell to show the sign-in screen (the sync panel's "Sign in" button). */
  reauthRequestId: number
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  toggleCommandPalette: () => void
  requestReauth: () => void
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'system',
  commandPaletteOpen: false,
  reauthRequestId: 0,

  setTheme: (theme) => set({ theme }),

  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

  requestReauth: () => set((state) => ({ reauthRequestId: state.reauthRequestId + 1 })),
}))
