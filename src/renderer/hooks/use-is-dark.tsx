import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'

const readDark = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

const listeners = new Set<() => void>()
let observer: MutationObserver | null = null

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!observer && typeof MutationObserver !== 'undefined') {
    // `applyTheme` toggles the `dark` class on <html>; that is the one place the theme lives.
    observer = new MutationObserver(() => listeners.forEach((notify) => notify()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && observer) {
      observer.disconnect()
      observer = null
    }
  }
}

const IsDarkContext = createContext<boolean | null>(null)

/**
 * The one subscription to the theme for the whole app. Components that style something by theme read
 * `useIsDark()` (a context read), instead of each reading the document class on every render or each
 * subscribing to it (D-REN-5).
 */
export function IsDarkProvider({ children }: { children: ReactNode }) {
  const isDark = useSyncExternalStore(subscribe, readDark, () => false)
  return <IsDarkContext.Provider value={isDark}>{children}</IsDarkContext.Provider>
}

/** Whether the dark theme is active; without a provider it reads the document once per render. */
export function useIsDark(): boolean {
  const fromProvider = useContext(IsDarkContext)
  return fromProvider ?? readDark()
}
