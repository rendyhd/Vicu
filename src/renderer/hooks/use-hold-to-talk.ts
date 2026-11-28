import { useCallback, useEffect, useRef } from 'react'
import { HOLD_MS, PRESS_IDLE, pressStep, type PressEvent, type PressState } from '@/lib/voice/press-gesture'
import { useVoiceStore } from '@/stores/voice-store'
import { can } from '@/lib/capabilities'

/**
 * True from the moment a hold starts listening until the next press: the click that follows it
 * (released on the button, or after Escape while still pressed) must not open the composer. It is
 * module wide because the list may re-render the button with a new instance while it is held.
 */
let swallowNextClick = false

export interface HoldToTalkProps {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
  onClickCapture: (event: React.MouseEvent<HTMLElement>) => void
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void
}

/**
 * Hold the + (new task) button to say a task (docs/voice-input.md, lib/voice/press-gesture.ts).
 * Spread the result on the button: a click still runs the button's onClick, a hold of HOLD_MS
 * starts listening, letting go adds, moving well away and letting go (or Escape) cancels, and
 * sliding up locks it into smart dictation when that is ready.
 */
const NO_HOLD: Partial<HoldToTalkProps> = {}

export function useHoldToTalk(): Partial<HoldToTalkProps> {
  const state = useRef<PressState>(PRESS_IDLE)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const detach = useRef<(() => void) | null>(null)

  const stopTracking = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    detach.current?.()
    detach.current = null
  }, [])

  const run = useCallback((event: PressEvent) => {
    const next = pressStep(state.current, event)
    state.current = next.state
    if (next.effect === 'start' || next.swallowClick) swallowNextClick = true
    const voice = useVoiceStore.getState()
    switch (next.effect) {
      case 'start': voice.begin('button', 'hold'); break
      case 'arm-cancel': voice.armCancel(true); break
      case 'disarm-cancel': voice.armCancel(false); break
      case 'add': voice.finish(); break
      case 'cancel': voice.cancel(); break
      case 'lock': voice.lock(); break
    }
    if (next.state.phase === 'idle' || next.state.phase === 'passive') {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
    }
    if (next.state.phase === 'idle') stopTracking()
  }, [stopTracking])

  // A hold outlives a re-render or remount of the button: its listeners are on the window, so
  // letting go still adds and Escape still cancels. Only a press that never became a hold stops.
  useEffect(() => () => {
    if (state.current.phase !== 'holding') stopTracking()
  }, [stopTracking])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    swallowNextClick = false
    const voice = useVoiceStore.getState()
    if (event.button !== 0 || voice.phase !== 'idle') return
    stopTracking()
    run({ type: 'down', at: performance.now(), x: event.clientX, y: event.clientY, lockable: voice.lockable })
    timer.current = setTimeout(() => run({ type: 'tick', at: performance.now() }), HOLD_MS)

    const onMove = (e: PointerEvent) => run({ type: 'move', x: e.clientX, y: e.clientY })
    const onUp = () => run({ type: 'up', at: performance.now() })
    const onAbort = () => run({ type: 'abort' })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onAbort() }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onAbort)
    window.addEventListener('blur', onAbort)
    window.addEventListener('keydown', onKey, true)
    detach.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onAbort)
      window.removeEventListener('blur', onAbort)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [run, stopTracking])

  const onClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    // A keyboard click (detail 0) is never swallowed, so a hold that ended without a pointerup
    // (a blurred window) cannot eat one.
    if (!swallowNextClick || event.detail === 0) return
    swallowNextClick = false
    event.preventDefault()
    event.stopPropagation()
  }, [])

  // A long press on a touch screen would open the context menu.
  const onContextMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (state.current.phase !== 'idle' && state.current.phase !== 'passive') event.preventDefault()
  }, [])

  // A host without voice input (the web version) has a button that only clicks.
  return can('voice') ? { onPointerDown, onClickCapture, onContextMenu } : NO_HOLD
}
