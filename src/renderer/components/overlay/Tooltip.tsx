import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { shortcutLabel } from '@/lib/shortcut-label'
import { leaveAsGhost } from './leave-ghost'
import { TOOLTIP_DELAY_MS, TOOLTIP_EDGE, TOOLTIP_GAP } from './tooltip-logic'

interface TooltipProps {
  /** What the control does. The control keeps its own accessible name; this is the visible hint. */
  label: string
  /** A shortcut such as `Mod+T`, written for the platform (see `shortcutLabel`). */
  shortcut?: string
  children: ReactNode
}

const isMac = window.api.platform === 'darwin'

/** Hides whichever tooltip is showing, so two are never on screen at once. */
let hideCurrent: (() => void) | null = null

/**
 * A styled tooltip for the control inside it. It shows after the pointer has rested on the control
 * (or keyboard focus has been on it) for 400 ms, grows in from the side of the control (the
 * `vicu-popover` motion: scale and fade, opacity only when motion is reduced), and goes on a press, Escape, leaving or
 * blur. It sits in the top layer like the popovers (a manual native popover positioned by Floating
 * UI), so no card or list clips it, and ignores the pointer so it never covers what is under it.
 *
 * The wrapper is `display: contents`, so the control keeps its place in the layout. The tooltip is
 * linked to the control with `aria-describedby`.
 */
export function Tooltip({ label, shortcut, children }: TooltipProps) {
  const id = useId()
  const anchorRef = useRef<HTMLElement | null>(null)
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }, [])

  const schedule = useCallback(
    (target: HTMLElement) => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        hideCurrent?.()
        anchorRef.current = target
        hideCurrent = hide
        setOpen(true)
      }, TOOLTIP_DELAY_MS)
    },
    [hide],
  )

  // The control inside gets the description link.
  useLayoutEffect(() => {
    const control = wrapperRef.current?.firstElementChild
    if (!control) return
    if (open) control.setAttribute('aria-describedby', id)
    else control.removeAttribute('aria-describedby')
  }, [open, id])

  // While a tooltip shows, Escape belongs to it: it goes, and the card behind it stays open.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      hide()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, hide])

  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (hideCurrent === hide) hideCurrent = null
    },
    [hide],
  )

  return (
    <span
      ref={wrapperRef}
      className="contents"
      onPointerEnter={(e) => {
        const control = wrapperRef.current?.firstElementChild
        if (control instanceof HTMLElement && e.pointerType !== 'touch') schedule(control)
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => {
        // Keyboard focus only: a click focuses the button too, and must not pop a tooltip.
        if (e.target instanceof HTMLElement && e.target.matches(':focus-visible')) schedule(e.target)
      }}
      onBlur={hide}
    >
      {children}
      {open && anchorRef.current && <TooltipBubble id={id} anchor={anchorRef.current} label={label} shortcut={shortcut} />}
    </span>
  )
}

function TooltipBubble({ id, anchor, label, shortcut }: { id: string; anchor: HTMLElement; label: string; shortcut?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.visibility = 'hidden'
    if (!el.matches(':popover-open')) el.showPopover()
    let alive = true
    void computePosition(anchor, el, {
      strategy: 'fixed',
      placement: 'top',
      middleware: [offset(TOOLTIP_GAP), flip(), shift({ padding: TOOLTIP_EDGE })],
    }).then(({ x, y, placement }) => {
      if (!alive) return
      el.style.left = `${x}px`
      el.style.top = `${y}px`
      el.dataset.placement = placement
      el.style.visibility = ''
    })
    return () => {
      alive = false
      // Fades out as it goes (a no-op when it was never placed).
      leaveAsGhost(el)
    }
  }, [anchor])

  return (
    <div
      ref={ref}
      id={id}
      popover="manual"
      role="tooltip"
      style={{ position: 'fixed' }}
      className="vicu-popover vicu-tooltip pointer-events-none m-0 inset-auto flex items-center gap-2 overflow-visible whitespace-nowrap rounded-control border-0 bg-text px-2 py-1 text-meta text-bg-page"
    >
      <span>{label}</span>
      {shortcut && <kbd className="font-sans text-caption opacity-70">{shortcutLabel(shortcut, isMac)}</kbd>}
    </div>
  )
}
