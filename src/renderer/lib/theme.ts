export type ThemeOption = 'light' | 'dark' | 'system'

export function applyTheme(theme: ThemeOption): void {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else if (theme === 'light') {
    root.classList.remove('dark')
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  }
}

/**
 * For the Quick Entry and Quick View windows: they follow the window's colour scheme (the main
 * process sets nativeTheme from the app theme), so the token colours in `.dark` switch with it.
 */
export function followColorScheme(): void {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => document.documentElement.classList.toggle('dark', query.matches)
  apply()
  query.addEventListener('change', apply)
}

/** Whether a window is dark: a chosen theme wins, the system theme (or none) follows the window. */
export function isDarkTheme(theme: string | null | undefined, prefersDark: boolean): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return prefersDark
}

let schemeQuery: MediaQueryList | null = null
let schemeQueryListening = false
let configuredTheme: string | null | undefined

/**
 * For a quick window that knows the configured app theme: a chosen light or dark is applied
 * directly (the media query of a transparent window is not trusted to report the native theme),
 * the system theme still follows the window.
 */
export function followConfiguredTheme(theme: string | null | undefined): void {
  configuredTheme = theme
  const query = (schemeQuery ??= window.matchMedia('(prefers-color-scheme: dark)'))
  if (!schemeQueryListening) {
    schemeQueryListening = true
    query.addEventListener('change', () => {
      document.documentElement.classList.toggle('dark', isDarkTheme(configuredTheme, query.matches))
    })
  }
  document.documentElement.classList.toggle('dark', isDarkTheme(configuredTheme, query.matches))
}
