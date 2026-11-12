import { useEffect } from 'react'
import { usePro } from './use-pro'
import { useProUiStore } from '@/stores/pro-ui-store'

/**
 * Pro's window-wide shortcuts (plan 7.1.11), mounted once in AppShell: Focus (Mod+Shift+O) and
 * Import meeting notes (Mod+Shift+M; Mod+Shift+I is the developer tools). Nothing while Pro is off.
 */
export function useProShortcuts(): void {
  const pro = usePro()
  const focusOn = pro.layer('availability')
  const promisesOn = pro.layer('promises')
  useEffect(() => {
    if (!focusOn && !promisesOn) return
    const onKey = (event: KeyboardEvent) => {
      const mod = window.api.platform === 'darwin' ? event.metaKey : event.ctrlKey
      if (!mod || !event.shiftKey || event.altKey || event.defaultPrevented) return
      const key = event.key.toLowerCase()
      if (key === 'o' && focusOn) {
        event.preventDefault()
        useProUiStore.getState().setFocusPickerOpen(true)
      } else if (key === 'm' && promisesOn) {
        event.preventDefault()
        useProUiStore.getState().open('pro-import')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [focusOn, promisesOn])
}
