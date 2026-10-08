import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { Placement } from '@floating-ui/dom'
import { cn } from '@/lib/cn'
import { useFloatingPopover } from './use-floating-popover'
import { OPTION_SELECTOR, TABBABLE_SELECTOR, nextOptionIndex, type PopoverInitialFocus } from './popover-logic'

export type PopoverRole = 'dialog' | 'listbox' | 'menu'

/** `dismiss`: the browser closed it (a press outside, or Escape). Absent: the caller closed it. */
export type PopoverCloseReason = 'dismiss'

export interface PopoverProps {
  /** The button that opened it. The popover sits next to it and focus returns to it on close. */
  anchorRef: RefObject<HTMLElement | null>
  /** Other buttons that toggle the same popover (a press on them does not count as outside). */
  invokedBy?: RefObject<HTMLElement | null>[]
  /**
   * Called when the browser dismisses the popover (press outside, Escape). Pickers also call it
   * themselves, without a reason, after a choice. The caller unmounts the popover in response.
   */
  onClose: (reason?: PopoverCloseReason) => void
  /** Accessible name. */
  label: string
  role?: PopoverRole
  placement?: Placement
  /** Where focus goes on open: the first control (default), the popover itself, nowhere, or a selector. */
  initialFocus?: PopoverInitialFocus
  /** Width, padding and the like. Colours and the border come from the primitive. */
  className?: string
  children: ReactNode
}

/**
 * A floating panel in the top layer (native `popover="auto"`): light dismiss on a press outside,
 * Escape, one open at a time except the ones nested inside it in the DOM. Position comes from
 * Floating UI (`useFloatingPopover`). Mounting opens it; render it only while it should be open.
 *
 * Focus moves into it on open and returns to the anchor on close. Listboxes and menus move
 * between their `role="option"` / `role="menuitem"` children with the arrow keys, Home and End.
 */
export function Popover({
  anchorRef,
  invokedBy,
  onClose,
  label,
  role = 'dialog',
  placement = 'bottom-start',
  initialFocus = 'first',
  className,
  children,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const focusRef = useRef(initialFocus)
  focusRef.current = initialFocus

  useFloatingPopover(anchorRef, ref, {
    placement,
    invokedBy,
    onPlaced: () => {
      const el = ref.current
      if (el) focusInitial(el, focusRef.current)
    },
  })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const onBeforeToggle = (event: Event) => {
      // Move focus out before the browser hides the popover; once hidden, focus would drop to <body>.
      if ((event as ToggleEvent).newState === 'closed') restoreFocus(el, anchorRef.current)
    }
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === 'closed') onCloseRef.current('dismiss')
    }
    el.addEventListener('beforetoggle', onBeforeToggle)
    el.addEventListener('toggle', onToggle)

    // While open, Escape belongs to the popover: the browser closes it (its default action), and
    // page handlers that listen for Escape (collapse the card, clear the selection, close the
    // menu) must not also run, and must not cancel the default action.
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)

    return () => {
      el.removeEventListener('beforetoggle', onBeforeToggle)
      el.removeEventListener('toggle', onToggle)
      window.removeEventListener('keydown', onKeyDown, true)
      // Closed by the caller (a choice was made): focus goes back to the anchor while the
      // popover is still in the document.
      restoreFocus(el, anchorRef.current)
    }
  }, [anchorRef])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (role === 'dialog') return
    const el = ref.current
    if (!el) return
    const options = Array.from(el.querySelectorAll<HTMLElement>(OPTION_SELECTOR)).filter(
      (option) => !option.hasAttribute('disabled'),
    )
    const next = nextOptionIndex(options.indexOf(document.activeElement as HTMLElement), options.length, event.key)
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    options[next]?.focus()
  }

  return (
    <div
      ref={ref}
      popover="auto"
      role={role}
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(
        // The browser's popover styles centre the box and give it padding, border and colours of
        // its own; reset them so Floating UI's left/top decide.
        'm-0 inset-auto overflow-y-auto overflow-x-hidden rounded-popover border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-lg focus:outline-none',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Focus the first control (the selected option of a list), the popover itself, a selector, or nothing. */
function focusInitial(el: HTMLElement, mode: PopoverInitialFocus): void {
  if (mode === 'none') return
  let target: HTMLElement | null = null
  if (mode === 'first') {
    target =
      el.querySelector<HTMLElement>('[data-autofocus]') ??
      el.querySelector<HTMLElement>('[aria-selected="true"],[aria-checked="true"]') ??
      el.querySelector<HTMLElement>(TABBABLE_SELECTOR)
  } else if (mode !== 'container') {
    target = el.querySelector<HTMLElement>(mode)
  }
  ;(target ?? el).focus({ preventScroll: true })
}

/** Moves focus to the anchor when it is inside the popover (so a press elsewhere keeps its own focus). */
function restoreFocus(popover: HTMLElement, anchor: HTMLElement | null): void {
  const active = document.activeElement
  if (!anchor || !anchor.isConnected || !active || !popover.contains(active)) return
  anchor.focus({ preventScroll: true })
}
