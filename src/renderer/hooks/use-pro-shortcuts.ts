import { useEffect } from 'react'
import { usePro } from './use-pro'
import { useProUiStore } from '@/stores/pro-ui-store'
import { useSelectionStore } from '@/stores/selection-store'

/**
 * Pro's window-wide shortcuts (plan 7.1.11), mounted once in AppShell: Focus (Mod+Shift+O) and
 * Import meeting notes (Mod+Shift+M; Mod+Shift+I is the developer tools) and the selection's
 * inspector (Mod+I, two or more tasks selected). Nothing while Pro is off.
 */
export function useProShortcuts(): void {
  const pro = usePro()
  const focusOn = pro.layer('availability')
  const promisesOn = pro.layer('promises')
  const powerOn = pro.layer('power')
  useEffect(() => {
    if (!focusOn && !promisesOn && !powerOn) return
    const onKey = (event: KeyboardEvent) => {
      const mod = window.api.platform === 'darwin' ? event.metaKey : event.ctrlKey
      if (mod && !event.shiftKey && !event.altKey && !event.defaultPrevented && powerOn && event.key.toLowerCase() === 'i' && useSelectionStore.getState().selectedTaskIds.size >= 2) {
        event.preventDefault()
        useProUiStore.getState().setInspectorOpen(true)
        return
      }
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
  }, [focusOn, promisesOn, powerOn])

  // An import pasted in Quick Entry (plan 7.1.9) opens its review here.
  useEffect(() => {
    if (!promisesOn) return
    return window.api.onProOpenImport((text) => useProUiStore.getState().open('pro-import', { text }))
  }, [promisesOn])
}
