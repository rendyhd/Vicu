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
