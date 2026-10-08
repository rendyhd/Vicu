import { useLayoutEffect, useRef } from 'react'
import { currentInput } from '@/lib/navigation-motion'
import { motionMs, motionSpringCurve } from '@/lib/motion'
import { readReducedMotion } from '@/hooks/use-reduced-motion'
import { pillSlide, PILL_REMEMBER_MS, type PillBox } from './selection-pill-logic'

// Where the previous pill was and when it left (card 4.6). Moving the selection unmounts one pill
// and mounts another in the same commit, so the new one starts where the old one was.
let previous: { box: PillBox; at: number } | null = null

const boxOf = (el: HTMLElement): PillBox => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/**
 * The highlight behind the active sidebar item. Selecting another item slides it from the old
 * item to the new one with the move spring (a transform on this element, so it stays behind the
 * labels). The sidebar root is `isolate` (Sidebar.tsx) and the item `relative`; the pill
 * sits at -z-10 behind every label. No slide under reduced motion or when the keyboard moved the
 * selection.
 */
export function SelectionPill() {
  const ref = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const last = previous
    previous = null
    if (last && performance.now() - last.at < PILL_REMEMBER_MS && !readReducedMotion() && currentInput() === 'pointer' && typeof el.animate === 'function') {
      const slide = pillSlide(last.box, boxOf(el))
      if (slide) {
        el.animate(
          [{ transform: `translate(${slide.dx}px, ${slide.dy}px) scale(${slide.sx}, ${slide.sy})` }, { transform: 'none' }],
          { duration: motionMs('move'), easing: motionSpringCurve('move') },
        )
      }
    }
    return () => {
      previous = { box: boxOf(el), at: performance.now() }
    }
  }, [])

  return <span ref={ref} data-sidebar-pill aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 origin-top-left rounded-control bg-[var(--bg-selected)]" />
}
