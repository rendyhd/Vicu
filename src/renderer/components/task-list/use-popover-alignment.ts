import { useLayoutEffect, useState, type RefObject } from 'react'

// Default anchoring is "left-0" (popover's left edge = anchor button's left edge,
// popover extends rightward). If that would overflow the viewport, flip to
// "right-0" (popover's right edge = anchor's right edge, extends leftward).
// Requires the popover to be rendered inside a `relative` wrapper that spans
// only the anchor button.
export function usePopoverAlignment(
  ref: RefObject<HTMLElement | null>
): 'left-0' | 'right-0' {
  const [align, setAlign] = useState<'left' | 'right'>('left')

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    if (rect.right > window.innerWidth - margin) {
      setAlign('right')
    }
  }, [ref])

  return align === 'left' ? 'left-0' : 'right-0'
}
