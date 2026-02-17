import { create } from 'zustand'

interface UIState {
  theme: 'light' | 'dark' | 'system'
  commandPaletteOpen: boolean
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  toggleCommandPalette: () => void
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'system',
  commandPaletteOpen: false,

  setTheme: (theme) => set({ theme }),

  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
}))
