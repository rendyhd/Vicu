import { create } from 'zustand'
import type { SettingsTab } from '@/lib/settings-menu'

/**
 * What the Settings menu shows, shared by the two places it is drawn (a column in the Settings page,
 * or the app sidebar's place when the page is narrow; lib/settings-menu.ts). SettingsView owns the
 * page: it lists the open tab's section headings, follows the one being read and registers `jumpTo`.
 */
interface SettingsNavState {
  tab: SettingsTab
  /** The menu is drawn in the app sidebar's place (set by AppShell from the content region's width). */
  inSidebar: boolean
  /** The open tab's section headings, in page order. */
  sections: string[]
  /** Index into `sections` of the one being read, -1 when none. */
  current: number
  /** Scrolls the page to a section; null while Settings is not open. */
  jumpTo: ((index: number) => void) | null
  setTab: (tab: SettingsTab) => void
  setInSidebar: (inSidebar: boolean) => void
  setSections: (sections: string[]) => void
  setCurrent: (current: number) => void
  setJumpTo: (jumpTo: ((index: number) => void) | null) => void
}

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

export const useSettingsNavStore = create<SettingsNavState>((set, get) => ({
  tab: 'general',
  inSidebar: false,
  sections: [],
  current: -1,
  jumpTo: null,
  setTab: (tab) => set({ tab }),
  setInSidebar: (inSidebar) => {
    if (get().inSidebar !== inSidebar) set({ inSidebar })
  },
  setSections: (sections) => {
    if (!sameList(get().sections, sections)) set({ sections })
  },
  setCurrent: (current) => {
    if (get().current !== current) set({ current })
  },
  setJumpTo: (jumpTo) => set({ jumpTo }),
}))
